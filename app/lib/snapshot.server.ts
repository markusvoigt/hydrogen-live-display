// ─────────────────────────────────────────────────────────────────────
//  Snapshot assembly — the Hydrogen replacement for the Durable
//  Object's poll loop (../src/live-state.ts).
//
//  There is no server-side poll loop on Oxygen: requests drive
//  freshness. The /api/snapshot route caches the assembled snapshot
//  for ~20 s (SNAPSHOT_TTL_S), so concurrent kiosks coalesce into one
//  upstream ShopifyQL tick. Slow-moving data (shop + locations,
//  product images) is cached longer via the same Cache API.
// ─────────────────────────────────────────────────────────────────────

import {createWithCache, CacheCustom} from '@shopify/hydrogen';

/** Same shape as Hydrogen's (unexported) WaitUntil type. */
type WaitUntil = (promise: Promise<unknown>) => void;
import {createAdminClient} from '~/lib/admin.server';
import {fetchAggregates, fetchProductImages} from '~/lib/shopifyql.server';
import {fetchShopAndLocations} from '~/lib/locations.server';
import type {Snapshot, ShopInfo, Location} from '~/lib/wall-types';

/** Poll cadence the kiosk is told to use, and the server-side cache
 *  TTL for the assembled snapshot. Matches the Worker's POLL_MS. */
export const SNAPSHOT_TTL_S = 20;
const LOCATIONS_TTL_S = 3600; // hourly, same as the DO
const IMAGES_TTL_S = 24 * 3600;

interface BuildSnapshotArgs {
  env: Env;
  request: Request;
  waitUntil: WaitUntil;
}

export async function buildSnapshot({
  env,
  request,
  waitUntil,
}: BuildSnapshotArgs): Promise<Snapshot> {
  const admin = createAdminClient(env);
  const withCache = createWithCache({
    cache: await caches.open('live-display'),
    waitUntil,
    request,
  });

  // Assemble (and cache) the whole snapshot. Every kiosk request within
  // the TTL gets the cached copy; one request per window pays for the
  // upstream ShopifyQL tick.
  return withCache.run(
    {
      cacheKey: ['wall-snapshot', admin.shop],
      cacheStrategy: CacheCustom({
        mode: 'public',
        maxAge: SNAPSHOT_TTL_S,
        staleWhileRevalidate: SNAPSHOT_TTL_S,
        staleIfError: 600,
      }),
      shouldCacheResult: (s: Snapshot) => Boolean(s?.asOf),
    },
    async () => {
      // 1. Shop + locations — hourly cache, same cadence as the DO.
      const shopAndLocations = await withCache.run(
        {
          cacheKey: ['wall-locations', admin.shop],
          cacheStrategy: CacheCustom({
            mode: 'public',
            maxAge: LOCATIONS_TTL_S,
            staleWhileRevalidate: LOCATIONS_TTL_S,
            staleIfError: 7 * 24 * 3600,
          }),
          shouldCacheResult: (v: {shop: ShopInfo; locations: Location[]}) =>
            Boolean(v?.shop?.name),
        },
        () => fetchShopAndLocations(admin),
      );

      // 2. The ShopifyQL tick — one batched request (+ isolated sessions).
      const agg = await fetchAggregates(admin);

      // 3. Product image hydration — cached per set of product ids.
      const ids = agg.topProducts.map((p) => p.productId).sort();
      if (ids.length > 0) {
        const images = await withCache.run(
          {
            cacheKey: ['wall-product-images', ...ids],
            cacheStrategy: CacheCustom({
              mode: 'public',
              maxAge: IMAGES_TTL_S,
              staleWhileRevalidate: IMAGES_TTL_S,
            }),
            shouldCacheResult: (v: Record<string, string>) =>
              Object.keys(v).length > 0,
          },
          () => fetchProductImages(admin, ids),
        );
        for (const p of agg.topProducts) {
          p.imageUrl = images[p.productId] ?? null;
        }
      }

      const snapshot: Snapshot = {
        asOf: new Date().toISOString(),
        currency: env.DISPLAY_CURRENCY || 'CAD',
        shop: shopAndLocations.shop,
        revenue24h: agg.revenue24h,
        orders24h: agg.orders24h,
        unitsSold24h: agg.unitsSold24h,
        activeCarts: agg.activeCarts,
        activeSessions: agg.activeSessions,
        aov: agg.aov,
        delta24hPct: agg.delta24hPct,
        topProducts: agg.topProducts,
        regions: agg.regions,
        locations: shopAndLocations.locations,
        channels: agg.channels,
        revenueSeries24h: agg.revenueSeries24h,
        ordersSeries24h: agg.ordersSeries24h,
        transport: 'poll',
        pollMs: SNAPSHOT_TTL_S * 1000,
        cityCuts: agg.cityCuts,
      };
      return snapshot;
    },
  );
}
