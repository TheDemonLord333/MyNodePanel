import { authenticator } from "otplib";
import qrcode from "qrcode";
import fs from "node:fs/promises";
import path from "node:path";

const SECRET_FILE = path.join(process.cwd(), ".2fa_secret");

export async function loadSecret() {
  try {
    const data = await fs.readFile(SECRET_FILE, "utf8");
    return data.trim() || null;
  } catch {
    return null;
  }
}

export async function saveSecret(secret) {
  await fs.writeFile(SECRET_FILE, secret, { mode: 0o600 });
}

export async function deleteSecret() {
  await fs.rm(SECRET_FILE, { force: true });
}

export function generateSecret() {
  return authenticator.generateSecret();
}

export function verifyCode(secret, code) {
  return authenticator.verify({ token: String(code).replace(/\s/g, ""), secret });
}

export async function generateQr(secret, accountName, issuer = "NodePanel") {
  const otpauth = authenticator.keyuri(accountName, issuer, secret);
  const qrDataUrl = await qrcode.toDataURL(otpauth, { margin: 1, width: 200 });
  return { otpauth, qrDataUrl };
}
