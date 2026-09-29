import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createHttpPolicy, loadSessionSecret } from "./http-policy.mjs";
const root = process.cwd();
if (existsSync(".env")) process.loadEnvFile?.(".env");
if (!existsSync("dist/index.html")) throw new Error("Run npm run build first.");
const apiPort = String(process.env.API_PORT || 8001);
const publicMode = process.env.BHOOMI_DEPLOYMENT_MODE === "public";
const workspaceDir =
  process.env.BHOOMI_WORKSPACE_DIR || path.join(root, "data/workspaces");
const internalToken = randomBytes(32).toString("hex");
const sessionSecret = publicMode ? loadSessionSecret(workspaceDir) : "";
const allowedOrigins = publicMode
  ? [
      process.env.PUBLIC_ORIGIN,
      process.env.RENDER_EXTERNAL_URL,
      process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : null,
    ].filter(Boolean)
  : [
      `http://localhost:${process.env.PORT || 3000}`,
      `http://127.0.0.1:${process.env.PORT || 3000}`,
    ];
if (publicMode && !allowedOrigins.length)
  throw new Error(
    "PUBLIC_ORIGIN, RENDER_EXTERNAL_URL, or RAILWAY_PUBLIC_DOMAIN is required for public mode.",
  );
const python = process.env.PYTHON || path.join(root, ".venv/bin/python");
const api = spawn(
  python,
  ["-m", "uvicorn", "ml.api:app", "--host", "127.0.0.1", "--port", apiPort],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      BHOOMI_INTERNAL_TOKEN: internalToken,
      BHOOMI_WORKSPACE_DIR: workspaceDir,
    },
  },
);
const app = express();
// The hosting edge terminates HTTPS. Only the final proxy hop is trusted.
if (publicMode) app.set("trust proxy", 1);
app.use(createHttpPolicy({ publicMode, sessionSecret, allowedOrigins }));
app.get("/api/config", (req, res) =>
  res.json({
    deployment_mode: publicMode ? "public" : "local",
    workspace: publicMode
      ? "Isolated browser workspace"
      : "Local research workspace",
    retention_days: publicMode ? 7 : null,
    storage_ephemeral: process.env.BHOOMI_STORAGE_EPHEMERAL === "true",
    max_upload_mb: publicMode ? 2 : 15,
  }),
);
app.use(
  "/api",
  express.raw({ type: () => true, limit: publicMode ? "2mb" : "20mb" }),
  async (req, res) => {
    try {
      const response = await fetch(
        `http://127.0.0.1:${apiPort}/api${req.url}`,
        {
          method: req.method,
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
            "x-internal-token": internalToken,
            ...(req.workspaceId ? { "x-workspace-id": req.workspaceId } : {}),
          },
          body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
        },
      );
      res
        .status(response.status)
        .type(response.headers.get("content-type") || "application/json")
        .send(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(503).json({
        detail: "Analysis service is starting or unavailable. Please retry.",
      });
    }
  },
);
app.use((error, req, res, next) => {
  if (error.type === "entity.too.large")
    return res
      .status(413)
      .json({ detail: `Upload exceeds the ${publicMode ? 2 : 15} MB limit.` });
  next(error);
});
app.use(express.static(path.join(root, "dist")));
app.get("/{*path}", (_, res) =>
  res.sendFile(path.join(root, "dist/index.html")),
);
let server;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  if (server) server.close(() => process.exit(code));
  else process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
api.on("error", (error) => {
  console.error("Cannot start Python API:", error.message);
  stop(1);
});
api.on("exit", (code) => {
  if (!stopping) {
    console.error("Analysis service stopped:", code);
    stop(code || 1);
  }
});
let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      headers: { "x-internal-token": internalToken },
    });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* Wait for the Python service to finish importing. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (ready && !stopping) {
  const port = process.env.PORT || 3000;
  server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`Bhoomi Suraksha → http://localhost:${port}`),
  );
  server.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
} else if (!stopping) {
  console.error("Analysis API did not become ready.");
  stop(1);
}
