export const GUEST_COOKIE = '__Host-ryde-guest';
export function guestToken(request) {
  const cookies = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(GUEST_COOKIE + '='));
  return cookies.length === 1 ? cookies[0].slice(GUEST_COOKIE.length + 1) : null;
}
export const guestCookie = (token, seconds = 86400) => `${GUEST_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? seconds : 0}`;
