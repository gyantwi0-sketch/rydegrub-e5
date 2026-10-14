import { sharedServiceLimits } from './service-limits.mjs';
import { providerRequest } from './provider-resilience.mjs';
import { boundedJsonObject, exactObjectFields, rejectQuery } from './request-validation.mjs';
import { completeRequest, requestTrace, safeError } from './request-observability.mjs';
import { AccessError, authenticateScoped, sameOrigin, serviceConfig } from './scoped-auth.mjs';
import { ProfileStore, validatePhone } from './profile-store.mjs';

const instances = new Map();
const HEADERS = {
  'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Origin',
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const json = (body, status = 200) => Response.json(body, {
  status, headers: { ...HEADERS, ...(status === 429 ? { 'Retry-After': '60' } : {}) },
});
function getStore(config) {
  if (!instances.has(config.dataDir)) instances.set(config.dataDir, new ProfileStore(config.dataDir));
  return instances.get(config.dataDir);
}
export function profileConfig(env = process.env) {
  const base = serviceConfig(env, 'PROFILE');
  const pepper = env.PROFILE_OTP_PEPPER;
  if (typeof pepper !== 'string' || Buffer.byteLength(pepper) < 32)
    throw new AccessError(503, 'Profile service is not configured.');
  const smsUrl = env.PROFILE_SMS_URL, smsKey = env.PROFILE_SMS_KEY;
  if (smsUrl !== undefined || smsKey !== undefined) {
    try {
      const url = new URL(smsUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          url.origin === base.origin || !smsKey) throw new Error();
    } catch { throw new AccessError(503, 'SMS provider is not configured.'); }
  }
  return { ...base, pepper, smsUrl, smsKey };
}
// Generic integration adapter: configured server-owned SMS provider only.
// Never choose provider URL from a request and never expose OTP in a response.
export async function sendPhoneCode(config, phone, code, request = providerRequest) {
  if (!config.smsUrl || !config.smsKey) throw new AccessError(503, 'Phone verification is not configured.');
  try {
    await request({
      provider: 'sms', url: config.smsUrl, method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.smsKey}` },
      body: JSON.stringify({ to: `+91${phone}`,
        message: `RydeGrub verification code: ${code}. Expires in 10 minutes. Do not share it.` }),
    });
  } catch {
    throw new AccessError(503, 'Phone verification is temporarily unavailable.');
  }
}
export async function readProfileBody(request, maxBytes = 2048) {
  return boundedJsonObject(request, {
    ErrorType: AccessError,
    message: 'Invalid JSON request.',
    maxBytes,
  });
}
function only(body, keys) {
  return exactObjectFields(body, keys, AccessError);
}

export function profileHandlers({ config = profileConfig, store = getStore, send = sendPhoneCode, limits = sharedServiceLimits, logger = console.info } = {}) {
  async function handle(request, action, operation) {
    const trace = requestTrace('profile', action);
    let response;
    try {
      await limits.before(request, 'profile');
      const settings = config();
      rejectQuery(request, AccessError);
      if (request.method !== 'GET') sameOrigin(request, settings);
      const owner = authenticateScoped(request, settings, '__Host-ryde-profile', 'profile:manage');
      await limits.owner('profile', owner);
      const database = store(settings);
      database.limit('global', 600);
      database.limit(`profile-owner:${owner}`, 120);
      response = await operation(owner, settings, database);
    } catch (error) {
      const failure = safeError(error, AccessError, 'Profile service unavailable.');
      response = json(failure.body, failure.status);
      if (failure.status === 429 && failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter));
    }
    return completeRequest(response, trace, logger);
  }
  return {
    read: request => handle(request, 'read', (owner, _settings, db) => json({ profile: db.read(owner) })),
    update: request => handle(request, 'update', async (owner, _settings, db) =>
      json({ profile: db.update(owner, only(await readProfileBody(request), ['name', 'preferences'])) })),
    changeConsent: request => handle(request, 'changeConsent', async (owner, _settings, db) =>
      json({ consents: db.consent(owner, only(await readProfileBody(request), ['purpose', 'granted'])) })),
    history: request => handle(request, 'history', (owner, _settings, db) =>
      json({ events: db.consentHistory(owner) })),
    startPhone: request => handle(request, 'startPhone', async (owner, settings, db) => {
      // Refuse to issue a code unless a real SMS delivery integration exists.
      if (!settings.smsUrl || !settings.smsKey) throw new AccessError(503, 'Phone verification is not configured.');
      const { phone } = only(await readProfileBody(request), ['phone']);
      validatePhone(phone);
      await limits.action('profile', 'phone-owner', owner, 3, 3600000);
      await limits.action('profile', 'phone', phone, 3, 3600000);
      const challenge = db.beginPhone(owner, phone, settings.pepper);
      try { await send(settings, phone, challenge.code); }
      catch {
        db.abortPhone(owner, challenge.nonce);
        throw new AccessError(503, 'Phone verification is temporarily unavailable.');
      }
      return json({ message: 'If delivery succeeds, enter the 8-digit code sent to your number.' }, 202);
    }),
    confirmPhone: request => handle(request, 'confirmPhone', async (owner, settings, db) => {
      const { code } = only(await readProfileBody(request), ['code']);
      return json({ profile: db.finishPhone(owner, code, settings.pepper) });
    }),
  };
}
export const profile = profileHandlers();

