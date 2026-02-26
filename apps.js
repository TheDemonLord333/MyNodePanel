import fs from "node:fs/promises";
import path from "node:path";

export function sanitizeAppName(name) {
  if (typeof name !== "string") return null;
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(name)) return null;
  return name;
}

export async function listApps(APPS_DIR) {
  const entries = await fs.readdir(APPS_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

export async function ensureAppDir(APPS_DIR, appName) {
  const safe = sanitizeAppName(appName);
  if (!safe) throw new Error("Invalid app name");
  const appDir = path.join(APPS_DIR, safe);
  // Realpath check to prevent traversal (extra safety)
  const realBase = await fs.realpath(APPS_DIR);
  await fs.mkdir(appDir, { recursive: true });
  const realApp = await fs.realpath(appDir);
  if (!realApp.startsWith(realBase + path.sep)) {
    throw new Error("Invalid app path");
  }
  return appDir;
}

export async function createApp(APPS_DIR, appName, port) {
  const appDir = await ensureAppDir(APPS_DIR, appName);

  // if already has package.json -> treat as existing
  try {
    await fs.access(path.join(appDir, "package.json"));
    throw new Error("App already exists (package.json present)");
  } catch {}

  const pkg = {
    name: appName,
    version: "1.0.0",
    main: "index.js",
    scripts: {
      start: "node index.js"
    },
    dependencies: {}
  };

  const indexJs = `
import http from "node:http";

const PORT = process.env.PORT || ${Number(port || 3000)};
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("Hello from ${appName}!\\n");
});

server.listen(PORT, () => console.log("Listening on", PORT));
`.trimStart();

  await fs.writeFile(path.join(appDir, "package.json"), JSON.stringify(pkg, null, 2));
  await fs.writeFile(path.join(appDir, "index.js"), indexJs);

  return { appDir };
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

  // Danger zone: delete directory recursively
  await fs.rm(realApp, { recursive: true, force: true });
}
