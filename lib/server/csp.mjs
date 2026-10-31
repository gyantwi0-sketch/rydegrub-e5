// CSP is intentionally constructed on the server for every HTML document.
// Firebase Auth uses a hidden helper iframe on the configured authDomain.
// Only that trusted HTTPS host may be framed; reject full URLs and wildcards.
export function firebaseAuthFrameSource(authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
  if (!authDomain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/i.test(authDomain))
    return "'none'";
  return `https://${authDomain.toLowerCase()}`;
}
// The nonce is not a reusable application secret; each response needs a new one.
export function documentCsp(nonce, development = false, authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) {
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
    `frame-src ${firebaseAuthFrameSource(authDomain)}`,
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
  `frame-src ${firebaseAuthFrameSource()}`,
].join('; ');
