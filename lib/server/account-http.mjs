import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { AccountError, AccountStore, emailAddress } from './account-store.mjs';
import { configuredLimiter, fingerprint, RateLimitError } from './rate-limit.mjs';
import { boundedJsonObject, rejectQuery } from './request-validation.mjs';
import { completeRequest, requestTrace } from './request-observability.mjs';

const stores = new Map();
export const SESSION_COOKIE = '__Host-ryde-session';
export function sessionToken(request) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${SESSION_COOKIE}=`));
  return values.length === 1 ? values[0].slice(SESSION_COOKIE.length + 1) : null;
}
export function accountConfig(env = process.env) {
  try {
    const origin = new URL(env.ACCOUNT_APP_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== env.ACCOUNT_APP_ORIGIN || !isAbsolute(env.ACCOUNT_DATA_DIR) ||
        !env.ACCOUNT_RATE_SECRET || env.ACCOUNT_RATE_SECRET.length < 32) throw new Error();
    return { origin: origin.origin, dataDir: env.ACCOUNT_DATA_DIR, secret: env.ACCOUNT_RATE_SECRET,
      ipHeader: env.ACCOUNT_TRUSTED_IP_HEADER, emailUrl: env.ACCOUNT_EMAIL_URL, emailKey: env.ACCOUNT_EMAIL_KEY };
  } catch { throw new AccountError(503, 'Account service is not configured.'); }
}
export function accountDatabase(config) {
  if (!stores.has(config.dataDir)) stores.set(config.dataDir, new AccountStore(config.dataDir));
  return stores.get(config.dataDir);
}
export function authenticatedAccount(request, { verified = true } = {}) {
  const account = accountDatabase(accountConfig()).session(sessionToken(request));
  if (verified && !account.verified) throw new AccountError(403, 'Verify your email first.');
  return account;
}
export async function checkBreachedPassword(password, fetchImpl = fetch) {
  // Only five SHA-1 characters leave this server; SHA-1 is NOT used for storage.
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const response = await fetchImpl(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'RydeGrub-Password-Screening' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error();
    const body = await response.text();
    if (body.length > 200000 || !body.trim()) throw new Error();
    const lines = body.trim().split(/\r?\n/);
    if (lines.some(line => !/^[A-F0-9]{35}:\d+$/.test(line))) throw new Error();
    return lines.some(line => { const [suffix, count] = line.split(':'); return suffix === hash.slice(5) && Number(count) > 0; });
  } catch { throw new AccountError(503, 'Password screening unavailable. Try again later.'); }
}
export async function sendAccountCode(config, purpose, email, token, fetchImpl = fetch) {
  try {
    const u = new URL(config.emailUrl);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !config.emailKey) throw new Error();
    const r = await fetchImpl(u, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${config.emailKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, template: purpose === 'verify' ? 'verify-email' : 'reset-password', code: token, expiresMinutes: 15 }) });
    if (!r.ok) throw new Error();
  } catch { throw new AccountError(503, 'Account email delivery unavailable.'); }
}
const FIELDS = { register: ['email','name','password'], signin: ['email','password'], logout: [],
  requestVerification: ['email'], requestReset: ['email'], verify: ['token'], reset: ['token','password'] };
const generic = { message: 'If this account is eligible, an email will arrive shortly.' };
const cookie = value => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? 28800 : 0}`;
export function accountHandlers({ config = accountConfig, store = accountDatabase, limiter = configuredLimiter,
  breached = checkBreachedPassword, send = sendAccountCode, logger = console.info } = {}) {
  async function handle(request, action) {
    const trace = requestTrace('account', action);
    let response;
    try {
      const settings = config();
      rejectQuery(request, AccountError);
      if (request.method !== (action === 'session' ? 'GET' : 'POST')) throw new AccountError(405, 'Method not allowed.');
      if (action !== 'session' && (request.headers.get('origin') !== settings.origin ||
        (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin'))) throw new AccountError(403, 'Same-origin request required.');
      const limits = limiter();
      await limits.consume('account:global', 300, 60000);
      // A deployment must strip client copies and set this header itself.
      // Without a trusted header use one shared bucket, never spoofable XFF.
      const candidate = settings.ipHeader ? request.headers.get(settings.ipHeader) : null;
      const ip = candidate && isIP(candidate) ? candidate : 'shared';
      await limits.consume(`account:ip:${fingerprint(settings.secret, 'ip', ip)}`, 60, 60000);
      const input = action === 'session' ? {} : await boundedJsonObject(request, { ErrorType: AccountError, maxBytes: 4096, allowedFields: FIELDS[action] });
      if (input.email !== undefined) {
        input.email = emailAddress(input.email);
        await limits.consume(`account:${action.toLowerCase()}:${fingerprint(settings.secret, 'email', input.email)}`, 5, 900000);
      }
      if (action === 'verify' || action === 'reset')
        await limits.consume(`account:token:${fingerprint(settings.secret, 'token', String(input.token))}`, 5, 900000);
      const db = store(settings);
      let body, status = 200, session;
      switch (action) {
        case 'register': {
          if (!settings.emailUrl || !settings.emailKey) throw new AccountError(503, 'Account email delivery is not configured.');
          const member = await db.register(input, breached);
          if (member) { const issued = db.issueToken(member.email, 'verify'); try { await send(settings, 'verify', issued.email, issued.token); } catch { try { logger(JSON.stringify({ event: 'account_delivery', outcome: 'unavailable' })); } catch { /* best effort */ } } }
          body = generic; status = 202; break;
        }
        case 'signin': { const result = await db.signIn(input.email, input.password, sessionToken(request)); body = { account: result.account }; session = result.token; break; }
        case 'session': body = { account: db.session(sessionToken(request)) }; break;
        case 'logout': db.logout(sessionToken(request)); body = { ok: true }; session = ''; break;
        case 'requestVerification': case 'requestReset': {
          if (!settings.emailUrl || !settings.emailKey) throw new AccountError(503, 'Account email delivery is not configured.');
          const purpose = action === 'requestReset' ? 'reset' : 'verify';
          const issued = db.issueToken(input.email, purpose);
          if (issued) { try { await send(settings, purpose, issued.email, issued.token); } catch { try { logger(JSON.stringify({ event: 'account_delivery', outcome: 'unavailable' })); } catch { /* best effort */ } } }
          body = generic; status = 202; break;
        }
        case 'verify': await db.redeem(input.token, 'verify'); body = { message: 'Email verified. You can now use your account.' }; break;
        case 'reset': await db.redeem(input.token, 'reset', input.password, breached); body = { message: 'Password changed. Sign in again.' }; session = ''; break;
        default: throw new AccountError(404, 'Not found.');
      }
      response = Response.json(body, { status, headers: { Vary: 'Cookie, Origin', ...(session !== undefined ? { 'Set-Cookie': cookie(session) } : {}) } });
    } catch (error) {
      const known = error instanceof AccountError || error instanceof RateLimitError;
      const status = known ? error.status : 503;
      response = Response.json({ error: known ? error.message : 'Account service unavailable.' }, { status,
        headers: status === 429 ? { 'Retry-After': String(error.retryAfter ?? 60) } : {} });
    }
    return completeRequest(response, trace, logger);
  }
  return Object.fromEntries(['session', ...Object.keys(FIELDS)].map(action => [action, request => handle(request, action)]));
}
export const account = accountHandlers();
