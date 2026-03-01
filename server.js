import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";

import { z } from "zod";
import { authMiddleware, issueToken, issueChallenge, verifyChallenge, signToken, decodeToken, verifyPassword } from "./auth.js";
import { loadSecret, saveSecret, deleteSecret, generateSecret, verifyCode, generateQr } from "./totp.js";
import { createApp, deleteApp, listApps, sanitizeAppName, TEMPLATES } from "./apps.js";
import { pm2Start, pm2Stop, pm2Delete, pm2ListJson, pm2Logs } from "./pm2.js";

const PORT = Number(process.env.PORT || 3000);
const APPS_DIR = process.env.APPS_DIR || "/srv/nodeapps";
const JWT_SECRET = process.env.JWT_SECRET || "change_me";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || "";

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // WICHTIG: sonst versucht der Browser https://... zu laden
        "upgrade-insecure-requests": null,
      },
    },
  })
);

app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// ---- Static UI ----
app.use("/", express.static(path.join(process.cwd(), "ui")));

// ---- Auth ----
app.post("/api/login", async (req, res) => {
  const schema = z.object({
    user: z.string().min(1),
    pass: z.string().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { user, pass } = parsed.data;
  if (user !== ADMIN_USER) return res.status(401).json({ error: "Invalid credentials" });
  if (!ADMIN_PASS_HASH) return res.status(500).json({ error: "Server not configured" });

  const ok = await verifyPassword({ plain: pass, hash: ADMIN_PASS_HASH });
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  // If 2FA is enabled, issue a short-lived challenge token instead of the full JWT
  const twoFaSecret = await loadSecret();
  if (twoFaSecret) {
    const challengeToken = issueChallenge({ user, jwtSecret: JWT_SECRET });
    return res.json({ requires2fa: true, challengeToken });
  }

  const token = issueToken({ user, jwtSecret: JWT_SECRET });
  res.json({ token });
});

const requireAuth = authMiddleware(JWT_SECRET);

// ---- 2FA ----

// Verify TOTP code after credential check (no auth required – uses challengeToken)
app.post("/api/2fa/verify", async (req, res) => {
  const schema = z.object({
    challengeToken: z.string(),
    code: z.string().min(6).max(8)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { challengeToken, code } = parsed.data;
  try {
    const decoded = verifyChallenge(challengeToken, JWT_SECRET);
    const secret = await loadSecret();
    if (!secret) return res.status(400).json({ error: "2FA not configured" });
    if (!verifyCode(secret, code)) return res.status(401).json({ error: "Ungültiger Code" });

    const token = issueToken({ user: decoded.user, jwtSecret: JWT_SECRET });
    res.json({ token });
  } catch {
    res.status(401).json({ error: "Ungültiger oder abgelaufener Challenge-Token" });
  }
});

// Get 2FA status
app.get("/api/2fa/status", requireAuth, async (req, res) => {
  const secret = await loadSecret();
  res.json({ enabled: !!secret });
});

// Begin 2FA setup – returns QR code + signed setupToken containing the pending secret
app.get("/api/2fa/setup", requireAuth, async (req, res) => {
  const existing = await loadSecret();
  if (existing) return res.status(409).json({ error: "2FA already enabled" });

  const secret = generateSecret();
  const { otpauth, qrDataUrl } = await generateQr(secret, ADMIN_USER);
  const setupToken = signToken({ pendingSecret: secret }, JWT_SECRET, { expiresIn: "10m" });
  res.json({ qrDataUrl, otpauth, setupToken });
});

// Confirm 2FA setup – verify code and persist secret
app.post("/api/2fa/setup", requireAuth, async (req, res) => {
  const schema = z.object({ setupToken: z.string(), code: z.string().min(6).max(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { setupToken, code } = parsed.data;
  try {
    const decoded = decodeToken(setupToken, JWT_SECRET);
    if (!decoded.pendingSecret) throw new Error("Invalid setup token");
    if (!verifyCode(decoded.pendingSecret, code)) {
      return res.status(400).json({ error: "Ungültiger Code – bitte erneut versuchen" });
    }
    await saveSecret(decoded.pendingSecret);
    res.json({ ok: true });
  } catch (e) {
    if (e.message === "Ungültiger Code – bitte erneut versuchen") {
      return res.status(400).json({ error: e.message });
    }
    res.status(400).json({ error: "Ungültiger oder abgelaufener Setup-Token" });
  }
});

// Disable 2FA – requires a valid current TOTP code
app.post("/api/2fa/disable", requireAuth, async (req, res) => {
  const schema = z.object({ code: z.string().min(6).max(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const secret = await loadSecret();
  if (!secret) return res.json({ ok: true });
  if (!verifyCode(secret, parsed.data.code)) {
    return res.status(400).json({ error: "Ungültiger Code" });
  }
  await deleteSecret();
  res.json({ ok: true });
});

// ---- Templates ----
app.get("/api/templates", requireAuth, (req, res) => {
  const list = Object.values(TEMPLATES).map(({ id, label, description }) => ({ id, label, description }));
  res.json(list);
});

// ---- Apps CRUD ----
app.get("/api/apps", requireAuth, async (req, res) => {
  const apps = await listApps(APPS_DIR);
  const pm2 = await pm2ListJson().catch(() => []);
  const byName = new Map(pm2.map(p => [p.name, p]));

  const enriched = apps.map(name => {
    const p = byName.get(name);
    return {
      name,
      status: p?.pm2_env?.status || "stopped",
      pid: p?.pid || null,
      cpu: p?.monit?.cpu ?? null,
      mem: p?.monit?.memory ?? null,
      restarts: p?.pm2_env?.restart_time ?? null
    };
  });

  res.json(enriched);
});

app.post("/api/apps", requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    template: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { name, port, template } = parsed.data;
  if (!sanitizeAppName(name)) return res.status(400).json({ error: "Invalid app name" });

  const created = await createApp(APPS_DIR, name, port, template);
  res.status(201).json({ ok: true, ...created });
});

app.delete("/api/apps/:name", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (!sanitizeAppName(name)) return res.status(400).json({ error: "Invalid app name" });

  // Stop/delete pm2 process first (ignore errors)
  await pm2Delete(name).catch(() => {});
  await deleteApp(APPS_DIR, name);

  res.json({ ok: true });
});

// ---- Process controls ----
app.post("/api/apps/:name/start", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (!sanitizeAppName(name)) return res.status(400).json({ error: "Invalid app name" });

  const cwd = path.join(APPS_DIR, name);
  // start via "npm start" or "node index.js"?
  // We'll start the file directly for simplicity:
  const script = "index.js";

  const out = await pm2Start({ name, script, cwd });
  res.json({ ok: true, out });
});

app.post("/api/apps/:name/stop", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (!sanitizeAppName(name)) return res.status(400).json({ error: "Invalid app name" });

  const out = await pm2Stop(name);
  res.json({ ok: true, out });
});

app.get("/api/apps/:name/logs", requireAuth, async (req, res) => {
  const name = req.params.name;
  if (!sanitizeAppName(name)) return res.status(400).json({ error: "Invalid app name" });

  const lines = Number(req.query.lines || 200);
  const out = await pm2Logs(name, Number.isFinite(lines) ? lines : 200);
  res.type("text/plain").send(out);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`NodePanel listening on http://127.0.0.1:${PORT}`);
});

