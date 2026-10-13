import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { documentCsp } from "./lib/server/csp.mjs";

export function proxy(request: NextRequest) {
  // Each HTML document gets a fresh unpredictable nonce. Next.js reads the
  // forwarded CSP request header when it emits hydration scripts.
  const nonce = randomBytes(16).toString("base64");
  const policy = documentCsp(nonce, process.env.NODE_ENV !== "production");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// API routes keep their own authentication/cache logic and global static CSP;
// Next.js document routes require a nonce. Exclude assets from dynamic rendering.
export const config = {
  matcher: [
    {
      source:
        "/((?!api(?:/|$)|_next/|images/|favicon.ico|apple-icon.png|icon.svg|icon-dark-32x32.png|icon-light-32x32.png|placeholder).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
