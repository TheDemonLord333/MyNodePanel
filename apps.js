import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

// ── Templates ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  http: {
    id: "http",
    label: "HTTP Server",
    description: "Einfacher HTTP-Server mit node:http (keine Dependencies)",
    dependencies: {},
    files: (appName, port) => ({
      "index.js": `import http from "node:http";

const PORT = process.env.PORT || ${port};

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Hello from ${appName}!\\n");
});

server.listen(PORT, () => console.log("${appName} listening on", PORT));
`,
    }),
  },

  express: {
    id: "express",
    label: "Express REST API",
    description: "REST API mit Express.js – GET /api/hello, POST /api/echo",
    dependencies: { express: "^5.0.0" },
    files: (appName, port) => ({
      "index.js": `import express from "express";

const PORT = process.env.PORT || ${port};
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ app: "${appName}", status: "ok" });
});

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from ${appName}!" });
});

app.post("/api/echo", (req, res) => {
  res.json({ echo: req.body });
});

app.listen(PORT, () => console.log("${appName} listening on", PORT));
`,
    }),
  },

  websocket: {
    id: "websocket",
    label: "WebSocket Server",
    description: "Echo-Server mit dem 'ws' Paket",
    dependencies: { ws: "^8.18.0" },
    files: (appName, port) => ({
      "index.js": `import { WebSocketServer } from "ws";

const PORT = process.env.PORT || ${port};
const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  console.log("Client connected");
  ws.send(JSON.stringify({ type: "welcome", app: "${appName}" }));

  ws.on("message", (data) => {
    console.log("Received:", data.toString());
    ws.send(data); // echo back
  });

  ws.on("close", () => console.log("Client disconnected"));
});

console.log("${appName} WebSocket listening on ws://localhost:" + PORT);
`,
    }),
  },

  tcp: {
    id: "tcp",
    label: "TCP Server",
    description: "Einfacher TCP Echo-Server mit node:net (keine Dependencies)",
    dependencies: {},
    files: (appName, port) => ({
      "index.js": `import net from "node:net";

const PORT = process.env.PORT || ${port};

const server = net.createServer((socket) => {
  console.log("Client connected:", socket.remoteAddress);
  socket.write("Welcome to ${appName}!\\n");

  socket.on("data", (data) => {
    socket.write(data); // echo back
  });

  socket.on("close", () => console.log("Client disconnected"));
  socket.on("error", (err) => console.error("Socket error:", err.message));
});

server.listen(PORT, () => console.log("${appName} TCP listening on", PORT));
`,
    }),
  },

  cron: {
    id: "cron",
    label: "Cron Job / Scheduler",
    description: "Hintergrundprozess mit periodischen Aufgaben (keine Dependencies)",
    dependencies: {},
    files: (appName, port) => ({
      "index.js": `// ${appName} – Background Job Scheduler
console.log("${appName} scheduler started at", new Date().toISOString());

// Runs every 60 seconds – replace with your logic
setInterval(() => {
  const now = new Date().toISOString();
  console.log(\`[${appName}:tick] \${now}\`);
  // TODO: add your task logic here
}, 60_000);

// Run once on startup
console.log(\`[${appName}:tick] \${new Date().toISOString()}\`);
`,
    }),
  },

  discord: {
    id: "discord",
    label: "Discord Bot",
    description: "Discord Bot Starter mit discord.js – antwortet auf !ping",
    dependencies: { "discord.js": "^14.18.0" },
    files: (appName, port) => ({
      "index.js": `import { Client, GatewayIntentBits } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Error: DISCORD_TOKEN environment variable is required");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", () => {
  console.log(\`${appName} logged in as \${client.user.tag}\`);
});

client.on("messageCreate", (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!ping") {
    msg.reply("Pong! 🏓");
  }
});

client.login(TOKEN);
`,
      ".env.example": `DISCORD_TOKEN=your_discord_bot_token_here\n`,
    }),
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function sanitizeAppName(name) {
  if (typeof name !== "string") return null;
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) return null;
  return name;
}

function npmInstall(appDir) {
  return new Promise((resolve) => {
    execFile("npm", ["install", "--prefix", appDir], { timeout: 90_000 }, (err) => {
      if (err) console.error(`npm install failed in ${appDir}:`, err.message);
      resolve(); // always resolve – app files are already written
    });
  });
}

// ── App management ────────────────────────────────────────────────────────────

export async function listApps(APPS_DIR) {
  const entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

export async function ensureAppDir(APPS_DIR, appName) {
  const safe = sanitizeAppName(appName);
  if (!safe) throw new Error("Invalid app name");
  const appDir = path.join(APPS_DIR, safe);
  const realBase = await fs.realpath(APPS_DIR);
  await fs.mkdir(appDir, { recursive: true });
  const realApp = await fs.realpath(appDir);
  if (!realApp.startsWith(realBase + path.sep)) {
    throw new Error("Invalid app path");
  }
  return appDir;
}

export async function createApp(APPS_DIR, appName, port, templateId = "http") {
  const appDir = await ensureAppDir(APPS_DIR, appName);

  // Reject if app already exists
  try {
    await fs.access(path.join(appDir, "package.json"));
    throw new Error("App already exists (package.json present)");
  } catch (e) {
    if (e.message.startsWith("App already exists")) throw e;
  }

  const tpl = TEMPLATES[templateId] ?? TEMPLATES.http;
  const resolvedPort = Number(port || 3000);

  const pkg = {
    name: appName,
    version: "1.0.0",
    type: "module",
    main: "index.js",
    scripts: { start: "node index.js" },
    dependencies: tpl.dependencies,
  };

  await fs.writeFile(path.join(appDir, "package.json"), JSON.stringify(pkg, null, 2));

  const files = tpl.files(appName, resolvedPort);
  for (const [filename, content] of Object.entries(files)) {
    await fs.writeFile(path.join(appDir, filename), content);
  }

  // Run npm install if the template has dependencies
  if (Object.keys(tpl.dependencies).length > 0) {
    await npmInstall(appDir);
  }

  return { appDir, template: tpl.id };
}

export async function deleteApp(APPS_DIR, appName) {
  const safe = sanitizeAppName(appName);
  if (!safe) throw new Error("Invalid app name");
  const appDir = path.join(APPS_DIR, safe);

  const realBase = await fs.realpath(APPS_DIR);
  const realApp = await fs.realpath(appDir).catch(() => null);
  if (!realApp || !realApp.startsWith(realBase + path.sep)) {
    throw new Error("App not found");
  }

  await fs.rm(realApp, { recursive: true, force: true });
}
