// ─────────────────────────────────────────────────────────────────────
//  Optional kiosk access gate.
//
//  Cloudflare Access does not follow the app to Oxygen. When the
//  KIOSK_TOKEN env var is set, `/` and `/api/snapshot` require either
//  `?key=<token>` in the URL or the cookie the kiosk page sets on a
//  successful keyed visit. When KIOSK_TOKEN is unset (dev, or an
//  intentionally public wall) everything is open.
//
//  This is a shared-secret screen, not real auth — fine for keeping
//  drive-by traffic off a signage endpoint. For anything stronger, put
//  a proxy (e.g. Cloudflare Access on a custom domain) in front.
// ─────────────────────────────────────────────────────────────────────

const COOKIE_NAME = 'kiosk_key';

function cookieValue(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isKioskAuthorized(request: Request, env: Env): boolean {
  const token = env.KIOSK_TOKEN;
  if (!token) return true;
  const url = new URL(request.url);
  if (url.searchParams.get('key') === token) return true;
  return cookieValue(request) === token;
}

/** Set on the kiosk page response after a successful `?key=` visit so
 *  subsequent /api/snapshot polls carry the credential. */
export function kioskCookieHeader(env: Env): string | null {
  const token = env.KIOSK_TOKEN;
  if (!token) return null;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
