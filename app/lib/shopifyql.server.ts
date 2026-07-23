// ─────────────────────────────────────────────────────────────────────
//  ShopifyQL aggregates — Hydrogen port of ../src/shopifyql.ts.
//
//  Identical query set and parsers; the only changes:
//    · `adminGraphql(env, store, …)` → `admin.graphql(…)` (static token)
//    · no per-tick query logger (Oxygen logs go to the storefront's
//      log stream; console.log lines survive)
//    · no FAST/SLOW cadence split — on Oxygen every cache miss runs the
//      full set (one batched request + one isolated sessions request),
//      and the 20 s snapshot cache bounds the call rate.
//    · diffCityCuts moved to the kiosk (frontend/src/pulses.ts): the
//      server keeps no pulse baseline on Oxygen.
// ─────────────────────────────────────────────────────────────────────

import type {AdminClient} from '~/lib/admin.server';
import {countryToCode} from '~/lib/geo';
import {classifyChannel} from '~/lib/wall-types';
import type {ChannelSplit, RegionCut, TopProduct, CityCut} from '~/lib/wall-types';

// ─────── ShopifyQL wire types ───────────────────────────────────────

interface QlTableData {
  columns: Array<{name: string}>;
  rows: Array<Record<string, unknown>>;
}

interface QlResponse {
  __typename: string;
  tableData?: QlTableData | null;
  parseErrors?: string[] | null;
}

/** Batch several ShopifyQL queries into one Admin GraphQL request via
 *  field aliases. A per-alias parse error is thrown as
 *  `<alias>: <messages>` so failures attribute to the right query. */
async function runQlBatch(
  admin: AdminClient,
  queries: Record<string, string>,
): Promise<Record<string, QlTableData>> {
  const aliases = Object.keys(queries);
  const varDefs = aliases.map((a) => `$${a}: String!`).join(', ');
  const fields = aliases
    .map((a) => `${a}: shopifyqlQuery(query: $${a}) { __typename ...QlResp }`)
    .join('\n  ');
  const doc = /* GraphQL */ `
    query LiveWallTick(${varDefs}) {
      ${fields}
    }
    fragment QlResp on ShopifyqlQueryResponse {
      tableData { columns { name } rows }
      parseErrors
    }
  `;
  const variables: Record<string, string> = {...queries};

  const data = await admin.graphql<Record<string, QlResponse>>(doc, variables);

  const out: Record<string, QlTableData> = {};
  for (const a of aliases) {
    const resp = data[a];
    if (!resp) throw new Error(`${a}: missing response`);
    if (resp.parseErrors && resp.parseErrors.length > 0) {
      throw new Error(`${a}: ShopifyQL parse errors: ${resp.parseErrors.join('; ')}`);
    }
    if (!resp.tableData) {
      throw new Error(`${a}: no tableData (typename ${resp.__typename})`);
    }
    out[a] = resp.tableData;
  }
  return out;
}

// ─────── Row helpers ─────────────────────────────────────────────────

function mustTable(tables: Record<string, QlTableData>, key: string): QlTableData {
  const t = tables[key];
  if (!t) throw new Error(`${key}: table missing from batch response`);
  return t;
}

function num(row: Record<string, unknown>, col: string): number {
  const v = row[col];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(row: Record<string, unknown>, col: string): string | null {
  const v = row[col];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parse a ShopifyQL hour-bucket timestamp into a comparable naive
 *  epoch. Values are only ever diffed against each other (same implied
 *  timezone), never against the wall clock. */
function naiveEpoch(s: string): number {
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : NaN;
}

// ─────── Aggregates: everything the Snapshot needs ───────────────────

export interface QlAggregates {
  revenue24h: number;
  orders24h: number;
  unitsSold24h: number;
  aov: number;
  delta24hPct: number | null;
  revenueSeries24h: number[];
  ordersSeries24h: number[];
  topProducts: TopProduct[];
  regions: RegionCut[];
  channels: ChannelSplit;
  activeCarts: number;
  activeSessions: number;
  /** Cumulative today-window city cuts; the kiosk diffs consecutive
   *  snapshots to synthesize globe pulses. */
  cityCuts: CityCut[];
}

const SERIES_BUCKETS = 24;
const HOUR_MS = 3600_000;
const TOP_PRODUCTS = 8;
const REGION_LIMIT = 50;
const CITY_LIMIT = 500;

// NOTE on windows: headline tiles + charts are an exact rolling 24h
// built from hour buckets. GROUP BY queries (products/regions/channels)
// can't express a rolling window in ShopifyQL, so they cover "since
// start of yesterday" (24–48h). Same grammar as the Worker version.
const QL = {
  hourly: `FROM sales SHOW total_sales, orders, net_items_sold TIMESERIES hour SINCE -1d UNTIL now`,
  cities: `FROM sales SHOW orders, total_sales GROUP BY shipping_country, shipping_city SINCE today UNTIL now ORDER BY orders DESC LIMIT ${CITY_LIMIT}`,
  products: `FROM sales SHOW total_sales, net_items_sold GROUP BY product_id, product_title SINCE -1d UNTIL now ORDER BY total_sales DESC LIMIT ${TOP_PRODUCTS}`,
  regions: `FROM sales SHOW total_sales, orders GROUP BY shipping_country SINCE -1d UNTIL now ORDER BY total_sales DESC LIMIT ${REGION_LIMIT}`,
  channels: `FROM sales SHOW total_sales, orders GROUP BY sales_channel SINCE -1d UNTIL now`,
  sessions: `FROM sessions SHOW sessions, sessions_with_cart_additions TIMESERIES hour SINCE today UNTIL now`,
} as const;

export async function fetchAggregates(admin: AdminClient): Promise<QlAggregates> {
  const tables = await runQlBatch(admin, {
    hourly: QL.hourly,
    cities: QL.cities,
    products: QL.products,
    regions: QL.regions,
    channels: QL.channels,
  });

  const hourly = parseHourly(mustTable(tables, 'hourly'));
  const cityCuts = parseCities(mustTable(tables, 'cities'));
  const topProducts = parseProducts(mustTable(tables, 'products'));
  const regions = parseRegions(mustTable(tables, 'regions'));
  const channels = parseChannels(mustTable(tables, 'channels'));

  // Active Sessions + Active Carts proxies — isolated so a scope/plan
  // gap degrades to 0 instead of poisoning the whole snapshot.
  let activeCarts = 0;
  let activeSessions = 0;
  try {
    const t = await runQlBatch(admin, {sessions: QL.sessions});
    const rows = mustTable(t, 'sessions').rows;
    const last = rows[rows.length - 1];
    activeCarts = last ? Math.round(num(last, 'sessions_with_cart_additions')) : 0;
    activeSessions = last ? Math.round(num(last, 'sessions')) : 0;
  } catch (err) {
    console.log(
      JSON.stringify({
        event: 'sessions_proxy_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  console.log(
    JSON.stringify({
      event: 'poll_summary',
      revenue24h: hourly.revenue24h,
      orders24h: hourly.orders24h,
      unitsSold24h: hourly.unitsSold24h,
      activeSessions,
      activeCarts,
      topProducts: topProducts.length,
      regions: regions.length,
      cityCuts: cityCuts.length,
    }),
  );

  return {
    ...hourly,
    topProducts,
    regions,
    channels,
    activeCarts,
    activeSessions,
    cityCuts,
  };
}

// ─────── Parsers (ported verbatim) ───────────────────────────────────

function parseHourly(t: QlTableData): Pick<
  QlAggregates,
  | 'revenue24h'
  | 'orders24h'
  | 'unitsSold24h'
  | 'aov'
  | 'delta24hPct'
  | 'revenueSeries24h'
  | 'ordersSeries24h'
> {
  interface Bucket {
    delta: number;
    revenue: number;
    orders: number;
    units: number;
  }
  const buckets: Bucket[] = [];
  let newest = -Infinity;
  const parsed = t.rows
    .map((r) => ({ts: naiveEpoch(str(r, 'hour') ?? ''), r}))
    .filter((x) => Number.isFinite(x.ts));
  for (const x of parsed) if (x.ts > newest) newest = x.ts;
  for (const {ts, r} of parsed) {
    buckets.push({
      delta: Math.round((newest - ts) / HOUR_MS),
      revenue: num(r, 'total_sales'),
      orders: num(r, 'orders'),
      units: num(r, 'net_items_sold'),
    });
  }

  let revenue24h = 0;
  let orders24h = 0;
  let unitsSold24h = 0;
  let prevRevenue = 0;
  let sawPrev = false;
  const revenueSeries24h = new Array<number>(SERIES_BUCKETS).fill(0);
  const ordersSeries24h = new Array<number>(SERIES_BUCKETS).fill(0);

  for (const b of buckets) {
    if (b.delta >= 0 && b.delta < SERIES_BUCKETS) {
      revenue24h += b.revenue;
      orders24h += b.orders;
      unitsSold24h += b.units;
      const idx = SERIES_BUCKETS - 1 - b.delta;
      revenueSeries24h[idx] = b.revenue;
      ordersSeries24h[idx] = b.orders;
    } else if (b.delta >= SERIES_BUCKETS && b.delta < SERIES_BUCKETS * 2) {
      prevRevenue += b.revenue;
      sawPrev = true;
    }
  }

  return {
    revenue24h: Math.round(revenue24h),
    orders24h,
    unitsSold24h: Math.max(0, Math.round(unitsSold24h)),
    aov: orders24h > 0 ? Math.round(revenue24h / orders24h) : 0,
    delta24hPct:
      sawPrev && prevRevenue > 0 ? ((revenue24h - prevRevenue) / prevRevenue) * 100 : null,
    revenueSeries24h,
    ordersSeries24h,
  };
}

function parseCities(t: QlTableData): CityCut[] {
  const out: CityCut[] = [];
  for (const r of t.rows) {
    const country = str(r, 'shipping_country');
    if (!country) continue;
    out.push({
      country,
      city: str(r, 'shipping_city') ?? '',
      orders: Math.max(0, Math.round(num(r, 'orders'))),
      revenue: num(r, 'total_sales'),
    });
  }
  return out;
}

function parseProducts(t: QlTableData): TopProduct[] {
  const out: TopProduct[] = [];
  for (const r of t.rows) {
    const id = r['product_id'];
    const title = str(r, 'product_title');
    if (id === null || id === undefined || !title) continue;
    out.push({
      productId: `gid://shopify/Product/${String(id)}`,
      title,
      imageUrl: null, // hydrated from the cached image lookup
      revenue: num(r, 'total_sales'),
      // Legacy field name — contains UNITS SOLD; the kiosk depends on it.
      orders: Math.round(num(r, 'net_items_sold')),
    });
  }
  return out.slice(0, TOP_PRODUCTS);
}

function parseRegions(t: QlTableData): RegionCut[] {
  const out: RegionCut[] = [];
  for (const r of t.rows) {
    const name = str(r, 'shipping_country');
    if (!name) continue;
    const code = countryToCode(name);
    if (!code) continue;
    out.push({
      country: code,
      revenue: num(r, 'total_sales'),
      orders: Math.round(num(r, 'orders')),
    });
  }
  return out.sort((a, b) => b.revenue - a.revenue).slice(0, REGION_LIMIT);
}

function parseChannels(t: QlTableData): ChannelSplit {
  const channels: ChannelSplit = {
    online: {orders: 0, revenue: 0},
    retail: {orders: 0, revenue: 0},
    other: {orders: 0, revenue: 0},
  };
  for (const r of t.rows) {
    const bucket = classifyChannel(str(r, 'sales_channel')) ?? 'other';
    channels[bucket].revenue += num(r, 'total_sales');
    channels[bucket].orders += Math.round(num(r, 'orders'));
  }
  return channels;
}

// ─────── Image hydration for specific product GIDs ──────────────────

interface ProductImagesResp {
  nodes: Array<{
    id: string;
    featuredMedia?: {preview?: {image?: {url: string}}};
  } | null>;
}

const PRODUCT_IMAGES = /* GraphQL */ `
  query ProductImages($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
      }
    }
  }
`;

export async function fetchProductImages(
  admin: AdminClient,
  ids: string[],
): Promise<Record<string, string>> {
  const byId: Record<string, string> = {};
  if (ids.length === 0) return byId;
  try {
    const imgs = await admin.graphql<ProductImagesResp>(PRODUCT_IMAGES, {ids});
    for (const n of imgs.nodes) {
      if (n?.id && n.featuredMedia?.preview?.image?.url) {
        byId[n.id] = n.featuredMedia.preview.image.url;
      }
    }
  } catch (err) {
    // Non-essential — titles + numbers are correct without images.
    console.log(
      JSON.stringify({
        event: 'product_images_failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return byId;
}
