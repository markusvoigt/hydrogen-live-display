// ─────────────────────────────────────────────────────────────────────
//  GET /api/snapshot — the kiosk's only data endpoint on Oxygen.
//
//  Replaces both the Worker's /api/snapshot and the SSE /stream: the
//  kiosk polls this every `pollMs` (20 s) and diffs `cityCuts` between
//  snapshots client-side to synthesize globe pulses.
//
//  Freshness: the snapshot is cached server-side for SNAPSHOT_TTL_S via
//  the Cache API (see snapshot.server.ts) and, when no KIOSK_TOKEN gate
//  is configured, also at the edge via Cache-Control — concurrent
//  kiosks cost one ShopifyQL tick per window.
// ─────────────────────────────────────────────────────────────────────

import type {Route} from './+types/api.snapshot';
import {buildSnapshot, SNAPSHOT_TTL_S} from '~/lib/snapshot.server';
import {isKioskAuthorized} from '~/lib/kiosk-auth.server';

export async function loader({request, context}: Route.LoaderArgs) {
  const env = context.env as Env;
  if (!isKioskAuthorized(request, env)) {
    return new Response('unauthorized', {status: 401});
  }

  try {
    const snapshot = await buildSnapshot({
      env,
      request,
      waitUntil: context.waitUntil ?? (() => {}),
    });
    return Response.json(snapshot, {
      headers: {
        // Token-gated responses must not be cached at the edge, or the
        // CDN would serve them to unauthenticated clients too.
        'cache-control': env.KIOSK_TOKEN
          ? 'private, no-store'
          : `public, max-age=${SNAPSHOT_TTL_S}`,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'snapshot_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return new Response('snapshot unavailable', {status: 503});
  }
}
