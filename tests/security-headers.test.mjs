import assert from "node:assert/strict";
import test from "node:test";
import config from "../next.config.mjs";

test("browser security headers are applied to all routes", async () => {
  const rules = await config.headers();
  const allRoutes = rules.find((rule) => rule.source === "/:path*");
  assert.ok(allRoutes, "expected a global header rule");

  const headers = Object.fromEntries(
    allRoutes.headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /object-src 'none'/);
  assert.match(headers["content-security-policy"], /base-uri 'self'/);
  assert.match(headers["content-security-policy"], /form-action 'self'/);
  assert.match(headers["permissions-policy"], /camera=\(\)/);
  assert.match(headers["permissions-policy"], /microphone=\(\)/);
  assert.match(headers["permissions-policy"], /geolocation=\(\)/);
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["strict-transport-security"], "max-age=63072000");
});
