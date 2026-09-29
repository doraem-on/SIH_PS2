import test from "node:test";
import assert from "node:assert/strict";
import {
  createHttpPolicy,
  signSession,
  verifySession,
  SESSION_TTL_SECONDS,
} from "../scripts/http-policy.mjs";
const secret = "test-only-key-not-a-deployed-secret";
const id = "a".repeat(32),
  issued = 1800000000;
function request(
  policy,
  {
    path = "/api/config",
    method = "GET",
    headers = {},
    ip = "test-client",
  } = {},
) {
  const result = { status: 200, headers: {}, next: false };
  const req = { path, method, headers, ip };
  const res = {
    setHeader(k, v) {
      result.headers[k] = v;
    },
    status(s) {
      result.status = s;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  policy(req, res, () => (result.next = true));
  result.workspaceId = req.workspaceId;
  return result;
}
test("session signature rejects modification and expiry", () => {
  const value = signSession(id, issued, secret);
  assert.equal(verifySession(value, secret, issued + 20), id);
  assert.equal(
    verifySession(value.replace(/^a/, "b"), secret, issued + 20),
    null,
  );
  assert.equal(
    verifySession(value, secret, issued + SESSION_TTL_SECONDS),
    null,
  );
  assert.equal(verifySession(value, secret, issued - 1), null);
});
test("public workspace uses secure cookie and accepts only signed identity", () => {
  const policy = createHttpPolicy({
    publicMode: true,
    sessionSecret: secret,
    allowedOrigins: ["https://bhoomi.example"],
    clock: () => issued * 1000,
  });
  const fresh = request(policy);
  assert.match(fresh.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax/);
  assert.match(fresh.workspaceId, /^[a-f0-9]{32}$/);
  const a = request(policy, {
    headers: {
      cookie: `__Host-bhoomi_workspace=${signSession(id, issued, secret)}`,
    },
  });
  assert.equal(a.workspaceId, id);
  const b = request(policy);
  assert.notEqual(a.workspaceId, b.workspaceId);
});
test("public data does not allocate workspaces and API is never CDN-cached", () => {
  const result = request(
    createHttpPolicy({ publicMode: true, sessionSecret: secret }),
    { path: "/api/models" },
  );
  assert.equal(result.workspaceId, undefined);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
});
test("cross-origin mutations are rejected, configured origin accepted", () => {
  const policy = createHttpPolicy({
    publicMode: true,
    sessionSecret: secret,
    allowedOrigins: ["https://bhoomi.example"],
  });
  assert.equal(
    request(policy, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }).status,
    403,
  );
  assert.equal(
    request(policy, {
      method: "POST",
      headers: { origin: "https://bhoomi.example" },
    }).next,
    true,
  );
});
test("mutation rate limit resets after a minute", () => {
  let now = issued * 1000;
  const policy = createHttpPolicy({
    publicMode: true,
    sessionSecret: secret,
    clock: () => now,
  });
  for (let i = 0; i < 20; i++)
    assert.equal(
      request(policy, { path: "/api/models/a/predict", method: "POST" }).status,
      200,
    );
  assert.equal(
    request(policy, { path: "/api/models/a/predict", method: "POST" }).status,
    429,
  );
  now += 61000;
  assert.equal(
    request(policy, { path: "/api/models/a/predict", method: "POST" }).status,
    200,
  );
});
