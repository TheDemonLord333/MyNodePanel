import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export function issueToken({ user, jwtSecret }) {
  return jwt.sign({ user }, jwtSecret, { expiresIn: "12h" });
}

export async function verifyPassword({ plain, hash }) {
  return bcrypt.compare(plain, hash);
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
