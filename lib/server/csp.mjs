// CSP is intentionally constructed on the server for every HTML document.
// The nonce is not a reusable application secret; each response needs a new one.
export function documentCsp(nonce, development = false) {
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
    `connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com${development ? " ws: wss:" : ''}`,
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
  "connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join('; ');
