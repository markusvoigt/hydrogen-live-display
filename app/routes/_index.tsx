// ─────────────────────────────────────────────────────────────────────
//  GET / — the kiosk page.
//
//  This is a resource route (no component): it serves the pre-built
//  WebGPU globe SPA verbatim. The HTML is produced by the frontend/
//  Vite build and vendored into app/kiosk/index.html by
//  `pnpm sync:hydrogen` (see scripts/sync-kiosk-to-hydrogen.mjs);
//  its hashed JS/CSS assets and static files live in public/.
// ─────────────────────────────────────────────────────────────────────

import type {Route} from './+types/_index';
// Vendored by `pnpm sync:hydrogen` — run it after every frontend build.
import kioskHtml from '~/kiosk/index.html?raw';
import {isKioskAuthorized, kioskCookieHeader} from '~/lib/kiosk-auth.server';

export async function loader({request, context}: Route.LoaderArgs) {
  const env = context.env as Env;
  if (!isKioskAuthorized(request, env)) {
    return new Response('unauthorized — append ?key=<KIOSK_TOKEN>', {status: 401});
  }

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache',
  });
  const cookie = kioskCookieHeader(env);
  if (cookie) headers.set('set-cookie', cookie);

  return new Response(kioskHtml, {headers});
}
