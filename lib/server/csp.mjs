// CSP: only allow outbound requests to the validated configured Supabase HTTPS origin.
export function supabaseConnectSource(url = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.origin === url.replace(/\/$/, "")
      ? parsed.origin
      : "";
  } catch {
    return "";
  }
}
// The nonce is not a reusable application secret; each response needs a new one.
export function documentCsp(nonce, development = false, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(nonce))
    throw new Error('A fresh 128-bit CSP nonce is required.');
  const sources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  return [
    "default-src 'self'",
    `script-src ${sources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com ${supabaseConnectSource(supabaseUrl)}${development ? " ws: wss:" : ''}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(!development ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

// Static responses that bypass the document proxy still have restrictive
// response headers. They must not permit inline untrusted scripts.
export const staticCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com ${supabaseConnectSource()}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join('; ');
