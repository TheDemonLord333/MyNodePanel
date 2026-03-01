import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export function issueToken({ user, jwtSecret }) {
  return jwt.sign({ user }, jwtSecret, { expiresIn: "12h" });
}

export async function verifyPassword({ plain, hash }) {
  return bcrypt.compare(plain, hash);
}

// Generic sign/verify used for setup tokens
export function signToken(payload, jwtSecret, options = {}) {
  return jwt.sign(payload, jwtSecret, options);
}

export function decodeToken(token, jwtSecret) {
  return jwt.verify(token, jwtSecret);
}

// Short-lived challenge token issued after credentials pass, before TOTP is verified
export function issueChallenge({ user, jwtSecret }) {
  return jwt.sign({ user, type: "2fa_challenge" }, jwtSecret, { expiresIn: "5m" });
}

export function verifyChallenge(token, jwtSecret) {
  const decoded = jwt.verify(token, jwtSecret);
  if (decoded.type !== "2fa_challenge") throw new Error("Not a challenge token");
  return decoded;
}

export function authMiddleware(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing token" });
    try {
      req.user = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}
