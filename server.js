import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";

import { z } from "zod";
import { authMiddleware, issueToken, verifyPassword } from "./auth.js";
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

  const token = issueToken({ user, jwtSecret: JWT_SECRET });
  res.json({ token });
});

const requireAuth = authMiddleware(JWT_SECRET);

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

