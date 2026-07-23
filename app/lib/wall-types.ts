// ─────────────────────────────────────────────────────────────────────
//  Shared wall types — Hydrogen port of the relevant parts of
//  ../src/types.ts. The wire shape matches what the kiosk frontend
//  expects (frontend/src/live.ts), plus the poll-transport additions:
//  `transport`, `pollMs`, and `cityCuts` (the kiosk diffs consecutive
//  snapshots client-side to synthesize globe pulses — the server keeps
//  no baseline state on Oxygen).
// ─────────────────────────────────────────────────────────────────────

export type OrderChannel = 'online' | 'retail' | 'other';

export function classifyChannel(source: string | null | undefined): OrderChannel | null {
  if (!source) return null;
  const s = String(source).toLowerCase().trim();
  if (s === 'pos' || s === 'point of sale' || s === 'point_of_sale') return 'retail';
  if (
    s === 'web' ||
    s === 'online store' ||
    s === 'online_store' ||
    s === '580111' ||
    s === 'checkout_one' ||
    s === 'shop' ||
    s === 'shop_app' ||
    s === 'iphone' ||
    s === 'android' ||
    s === 'mobile_app'
  ) {
    return 'online';
  }
  return 'other';
}

export interface ChannelCut {
  orders: number;
  revenue: number;
}

export interface ChannelSplit {
  online: ChannelCut;
  retail: ChannelCut;
  other: ChannelCut;
}

export interface ShopInfo {
  name: string;
  primaryDomain: string;
  hq: {city: string | null; countryCode: string | null; lat: number | null; lng: number | null};
}

export interface TopProduct {
  productId: string;
  title: string;
  imageUrl: string | null;
  revenue: number;
  /** Units sold — legacy field name, the kiosk depends on it. */
  orders: number;
}

export interface RegionCut {
  country: string;
  orders: number;
  revenue: number;
}

export interface Location {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  fulfillsOnlineOrders: boolean;
}

/** Cumulative today-window city cut. The kiosk diffs consecutive
 *  snapshots to synthesize pulses (see frontend/src/pulses.ts). */
export interface CityCut {
  country: string;
  city: string;
  orders: number;
  revenue: number;
}

export interface Snapshot {
  asOf: string;
  currency: string;
  shop: ShopInfo;
  revenue24h: number;
  orders24h: number;
  unitsSold24h: number;
  activeCarts: number;
  activeSessions: number;
  aov: number;
  delta24hPct: number | null;
  topProducts: TopProduct[];
  regions: RegionCut[];
  locations: Location[];
  channels: ChannelSplit;
  revenueSeries24h: number[];
  ordersSeries24h: number[];
  /** Tells the kiosk to poll instead of opening an SSE stream. */
  transport: 'poll';
  /** Poll cadence hint for the kiosk. */
  pollMs: number;
  /** Cumulative today-window city cuts for client-side pulse diffing. */
  cityCuts: CityCut[];
}
