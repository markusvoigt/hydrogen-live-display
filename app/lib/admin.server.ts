// ─────────────────────────────────────────────────────────────────────
//  Admin GraphQL client — Hydrogen/Oxygen port of ../src/shopify.ts.
//
//  AUTH: OAuth 2.0 client credentials grant (the Dev Dashboard app
//  flow — https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant).
//  The app exchanges its client ID + secret directly with the shop for
//  an access token; tokens expire after 24 h (`expires_in: 86399`) and
//  "refreshing" is simply requesting a new one with the same
//  credentials. No user interaction, no refresh-token persistence —
//  which is what makes this flow work on Oxygen, where there is no
//  Durable Object to store a session in. This replaces the Worker's
//  authorization-code + refresh-token machinery (oauth.ts, session.ts).
//
//  Caveat: client credentials only works when the app and the store
//  belong to the same organization in the Dev Dashboard. A wrong org
//  pairing fails with `shop_not_permitted`.
//
//  Tokens are cached in isolate memory and renewed 5 min before
//  expiry; a 401 mid-flight forces one re-mint + retry (covers
//  revocation or cross-isolate clock skew). The calculated-query-cost
//  THROTTLED back-off is ported unchanged.
// ─────────────────────────────────────────────────────────────────────

export interface AdminClient {
  shop: string;
  apiVersion: string;
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

interface GraphqlError {
  message: string;
  extensions?: {code?: string};
}

interface CostExtensions {
  cost?: {
    requestedQueryCost?: number;
    actualQueryCost?: number | null;
    throttleStatus?: {
      maximumAvailable: number;
      currentlyAvailable: number;
      restoreRate: number;
    };
  };
}

const MAX_THROTTLE_RETRIES = 5;
const MAX_THROTTLE_WAIT_MS = 10_000;
// Renew the token this long before its stated expiry (same margin the
// Worker's session.ts used).
const TOKEN_RENEW_MARGIN_MS = 5 * 60_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function throttleWaitMs(ext: CostExtensions | undefined): number {
  const ts = ext?.cost?.throttleStatus;
  const requested = ext?.cost?.requestedQueryCost ?? 0;
  if (ts && ts.restoreRate > 0) {
    const deficit = Math.max(requested - ts.currentlyAvailable, ts.restoreRate);
    return Math.min(Math.ceil((deficit / ts.restoreRate) * 1000), MAX_THROTTLE_WAIT_MS);
  }
  return 1000;
}

// ─────── Token cache (per isolate) ───────────────────────────────────
//
// Isolate-local on purpose: tokens are secrets, so they stay out of the
// shared Cache API. A cold isolate pays one extra token request per
// 24 h window — negligible. Single-flight so concurrent snapshot
// requests can't stampede the token endpoint.

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();
const tokenInFlight = new Map<string, Promise<CachedToken>>();

interface TokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function mintToken(shop: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const body = (await r.json()) as TokenResponse;
  if (r.status !== 200 || !body.access_token) {
    // e.g. `shop_not_permitted` when app + store aren't in the same org.
    throw new Error(
      `client_credentials grant failed (HTTP ${r.status}): ` +
        `${body.error ?? 'unknown'}${body.error_description ? ` — ${body.error_description}` : ''}`,
    );
  }
  const ttlMs = Math.max(60_000, (body.expires_in ?? 86_399) * 1000);
  console.log(
    JSON.stringify({event: 'admin_token_minted', shop, expiresInS: body.expires_in ?? null}),
  );
  return {token: body.access_token, expiresAt: Date.now() + ttlMs};
}

async function getAccessToken(
  shop: string,
  clientId: string,
  clientSecret: string,
  forceRefresh = false,
): Promise<string> {
  const key = `${shop}\u0000${clientId}`;
  const cached = tokenCache.get(key);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt - TOKEN_RENEW_MARGIN_MS) {
    return cached.token;
  }
  let inFlight = tokenInFlight.get(key);
  if (!inFlight) {
    inFlight = mintToken(shop, clientId, clientSecret).finally(() =>
      tokenInFlight.delete(key),
    );
    tokenInFlight.set(key, inFlight);
  }
  const fresh = await inFlight;
  tokenCache.set(key, fresh);
  return fresh.token;
}

// ─────── Client ──────────────────────────────────────────────────────

export function createAdminClient(env: Env): AdminClient {
  const shop = env.ADMIN_SHOP_DOMAIN || env.PUBLIC_STORE_DOMAIN;
  const apiVersion = env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
  const clientId = env.SHOPIFY_API_KEY;
  const clientSecret = env.SHOPIFY_API_SECRET;
  if (!shop) throw new Error('ADMIN_SHOP_DOMAIN / PUBLIC_STORE_DOMAIN is not set');
  if (!clientId || !clientSecret) {
    throw new Error('SHOPIFY_API_KEY / SHOPIFY_API_SECRET environment variables are not set');
  }

  async function graphql<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let did401Retry = false;
    let forceRefresh = false;
    let throttleRetries = 0;
    for (;;) {
      const token = await getAccessToken(shop, clientId, clientSecret, forceRefresh);
      forceRefresh = false;
      const r = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': token,
        },
        body: JSON.stringify({query, variables}),
      });
      const body = (await r.json()) as {
        data?: T;
        errors?: GraphqlError[];
        extensions?: CostExtensions;
      };

      if (r.status === 401 && !did401Retry) {
        // Token expired or was revoked mid-window — mint a fresh one
        // and retry once.
        did401Retry = true;
        forceRefresh = true;
        continue;
      }
      if (r.status !== 200) {
        throw new Error(`Admin GraphQL HTTP ${r.status}: ${JSON.stringify(body)}`);
      }

      if (body.errors?.length) {
        const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (throttled && throttleRetries < MAX_THROTTLE_RETRIES) {
          throttleRetries += 1;
          await sleep(throttleWaitMs(body.extensions));
          continue;
        }
        throw new Error(`Admin GraphQL errors: ${JSON.stringify(body.errors)}`);
      }

      return body.data as T;
    }
  }

  return {shop, apiVersion, graphql};
}
