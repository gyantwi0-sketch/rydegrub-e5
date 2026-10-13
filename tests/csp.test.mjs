import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { documentCsp, staticCsp } from "../lib/server/csp.mjs";
import config from "../next.config.mjs";

const directives = (policy) => new Map(policy.split("; ").map((entry) => {
  const first = entry.indexOf(" ");
  return first < 0 ? [entry, ""] : [entry.slice(0, first), entry.slice(first + 1)];
}));

test("Next.js document CSP uses a strict unpredictable script nonce and no inline bypass", () => {
  const first = randomBytes(16).toString("base64");
  const second = randomBytes(16).toString("base64");
  const p1 = documentCsp(first);
  const p2 = documentCsp(second);
  assert.notEqual(first, second);
  assert.notEqual(p1, p2);
  const d = directives(p1);
  assert.match(d.get("script-src"), new RegExp(`'nonce-${first}'`));
  assert.match(d.get("script-src"), /'strict-dynamic'/);
  assert.doesNotMatch(d.get("script-src"), /unsafe-inline|unsafe-eval|\*/);
  assert.equal(d.get("frame-ancestors"), "'none'");
  assert.equal(d.get("frame-src"), "'none'");
  assert.equal(d.get("object-src"), "'none'");
  assert.equal(d.get("base-uri"), "'self'");
  assert.equal(d.get("form-action"), "'self'");
  assert.match(d.get("img-src"), /data: blob:/);
  assert.ok(d.has("upgrade-insecure-requests"));
  for (const bad of ["short", "", "with spaces", "'unsafe-inline'", "<script>", null])
    assert.throws(() => documentCsp(bad));
});
test("development CSP enables eval only for Next hot reload; static routes disallow inline scripts", () => {
  const nonce = randomBytes(16).toString("base64");
  const dev = directives(documentCsp(nonce, true));
  assert.match(dev.get("script-src"), /'unsafe-eval'/);
  assert.ok(!dev.has("upgrade-insecure-requests"));
  const fallback = directives(staticCsp);
  assert.equal(fallback.get("script-src"), "'self'");
  assert.equal(fallback.get("frame-ancestors"), "'none'");
});
test("all routes get clickjacking, secure transport and cross-origin protections", async () => {
  const global = (await config.headers()).find((rule) => rule.source === "/:path*");
  assert.ok(global);
  const h = Object.fromEntries(global.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(h["x-frame-options"], "DENY");
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["strict-transport-security"], "max-age=63072000");
  assert.equal(h["cross-origin-opener-policy"], "same-origin");
  assert.equal(h["cross-origin-resource-policy"], "same-origin");
  assert.equal(h["permissions-policy"], "camera=(), microphone=(), geolocation=()");
  assert.equal(h["content-security-policy"], staticCsp);
});
test("document proxy and layout are wired to use CSP request header and dynamic SSR", () => {
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(proxy, /randomBytes\(16\)\.toString\("base64"\)/);
  assert.match(proxy, /requestHeaders\.set\("Content-Security-Policy", policy\)/);
  assert.match(proxy, /response\.headers\.set\("Content-Security-Policy", policy\)/);
  assert.match(proxy, /response\.headers\.set\("Cache-Control", "private, no-store"\)/);
  assert.match(proxy, /source:/);
  assert.match(layout, /await headers\(\)/);
});
