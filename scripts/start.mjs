import express from "express";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
if (existsSync(".env")) process.loadEnvFile?.(".env");
if (!existsSync("dist/index.html")) throw new Error("Run npm run build first.");
const python = process.env.PYTHON || path.join(root, ".venv/bin/python");
const api = spawn(
  python,
  ["-m", "uvicorn", "ml.api:app", "--host", "127.0.0.1", "--port", "8001"],
  { stdio: "inherit" },
);
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    ![
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      `http://localhost:${process.env.PORT || 3000}`,
      `http://127.0.0.1:${process.env.PORT || 3000}`,
    ].includes(origin)
  )
    return res
      .status(403)
      .json({ detail: "Cross-origin requests are not allowed." });
  next();
});
app.use(
  "/api",
  express.raw({ type: () => true, limit: "20mb" }),
  async (req, res) => {
    try {
      const response = await fetch(`http://127.0.0.1:8001/api${req.url}`, {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      });
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
    const response = await fetch("http://127.0.0.1:8001/api/health");
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
