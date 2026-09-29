import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const COOKIE = "__Host-bhoomi_workspace";
export function loadSessionSecret(directory) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, ".session-key");
  if (!existsSync(file))
    writeFileSync(file, randomBytes(48).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  return readFileSync(file, "utf8").trim();
}
export function signSession(id, issued, secret) {
  const value = `${id}.${issued}`;
  return `${value}.${createHmac("sha256", secret).update(value).digest("hex")}`;
}
export function verifySession(
  value,
  secret,
  now = Math.floor(Date.now() / 1000),
) {
  if (!/^[a-f0-9]{32}\.\d{10}\.[a-f0-9]{64}$/.test(value || "")) return null;
  const [id, issued, signature] = value.split(".");
  if (+issued > now || now - +issued >= SESSION_TTL_SECONDS) return null;
  const expected = signSession(id, issued, secret).split(".")[2];
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  )
    ? id
    : null;
}
export function createHttpPolicy({
  publicMode,
  sessionSecret,
  allowedOrigins = [],
  clock = Date.now,
}) {
  const clients = new Map();
  let nextSweep = 0;
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (publicMode)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    const isApi = req.path.startsWith("/api/");
    if (!isApi) return next();
    res.setHeader("Cache-Control", "private, no-store");
    const origin = req.headers.origin;
    if (
      (origin && !allowedOrigins.includes(origin)) ||
      (req.headers["sec-fetch-site"] === "cross-site" &&
        !["GET", "HEAD", "OPTIONS"].includes(req.method))
    ) {
      return res
        .status(403)
        .json({ detail: "Cross-origin requests are not allowed." });
    }
    if (publicMode && req.path !== "/api/health") {
      const now = clock();
      if (now >= nextSweep) {
        for (const [key, value] of clients)
          if (value.until <= now) clients.delete(key);
        nextSweep = now + 60_000;
      }
      const key = req.ip;
      let bucket = clients.get(key);
      if (!bucket || bucket.until <= now) {
        if (clients.size >= 10_000)
          return res
            .status(503)
            .json({ detail: "The demo is busy. Please retry shortly." });
        bucket = { count: 0, mutations: 0, until: now + 60_000 };
        clients.set(key, bucket);
      }
      bucket.count++;
      if (req.method === "POST") bucket.mutations++;
      if (bucket.count > 120 || bucket.mutations > 20) {
        res.setHeader("Retry-After", Math.ceil((bucket.until - now) / 1000));
        return res
          .status(429)
          .json({
            detail: "Demo request limit reached. Try again in a minute.",
          });
      }
      const needsWorkspace =
        /^\/api\/(config|overview|sources|matches|harmonize|audit|export|relocation)(\/|$)/.test(
          req.path,
        );
      if (needsWorkspace) {
        const cookies = String(req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim());
        const value = cookies
          .find((v) => v.startsWith(COOKIE + "="))
          ?.slice(COOKIE.length + 1);
        let id = verifySession(value, sessionSecret, Math.floor(now / 1000));
        if (!id) {
          id = randomBytes(16).toString("hex");
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=${signSession(id, Math.floor(now / 1000), sessionSecret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
          );
        }
        req.workspaceId = id;
      }
    }
    next();
  };
}
