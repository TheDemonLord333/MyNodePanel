import { execFile } from "node:child_process";

function runPm2(args) {
  return new Promise((resolve, reject) => {
    execFile("pm2", args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

export async function pm2Start({ name, script, cwd }) {
  // pm2 start <script> --name <name> --cwd <cwd>
  return runPm2(["start", script, "--name", name, "--cwd", cwd]);
}

export async function pm2Stop(name) {
  return runPm2(["stop", name]);
}

export async function pm2Delete(name) {
  return runPm2(["delete", name]);
}

export async function pm2ListJson() {
  // pm2 jlist liefert JSON
  const out = await runPm2(["jlist"]);
  return JSON.parse(out);
}

export async function pm2Logs(name, lines = 200) {
  // pm2 logs <name> --lines <n> --nostream
  return runPm2(["logs", name, "--lines", String(lines), "--nostream"]);
}
