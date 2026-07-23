// ─────────────────────────────────────────────────────────────────────
//  Shop HQ + retail locations — Hydrogen port of ../src/locations.ts.
//  Only the client plumbing changed (AdminClient instead of env+store).
// ─────────────────────────────────────────────────────────────────────

import type {AdminClient} from '~/lib/admin.server';
import {lookupCentroid} from '~/lib/geo';
import type {Location, ShopInfo} from '~/lib/wall-types';

interface ShopAndLocationsResp {
  shop: {
    name: string;
    primaryDomain: {url: string};
    billingAddress: {
      city: string | null;
      countryCodeV2: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
  };
  locations: {
    edges: Array<{
      node: {
        id: string;
        name: string;
        isActive: boolean;
        fulfillsOnlineOrders: boolean;
        address: {
          city: string | null;
          countryCode: string | null;
          latitude: number | null;
          longitude: number | null;
        };
        showOnDisplay: {value: string} | null;
      };
    }>;
  };
}

const QUERY = /* GraphQL */ `
  query ShopAndLocations {
    shop {
      name
      primaryDomain {
        url
      }
      billingAddress {
        city
        countryCodeV2
        latitude
        longitude
      }
    }
    locations(first: 250, includeInactive: false) {
      edges {
        node {
          id
          name
          isActive
          fulfillsOnlineOrders
          address {
            city
            countryCode
            latitude
            longitude
          }
          showOnDisplay: metafield(namespace: "display", key: "show") {
            value
          }
        }
      }
    }
  }
`;

export async function fetchShopAndLocations(
  admin: AdminClient,
): Promise<{shop: ShopInfo; locations: Location[]}> {
  const data = await admin.graphql<ShopAndLocationsResp>(QUERY);

  const billing = data.shop.billingAddress;
  let hqLat = billing?.latitude ?? null;
  let hqLng = billing?.longitude ?? null;
  if ((hqLat === null || hqLng === null) && billing?.countryCodeV2) {
    const c = lookupCentroid(billing.countryCodeV2);
    if (c) {
      hqLng = c[0];
      hqLat = c[1];
    }
  }
  const shop: ShopInfo = {
    name: data.shop.name,
    primaryDomain: data.shop.primaryDomain.url,
    hq: {
      city: billing?.city ?? null,
      countryCode: billing?.countryCodeV2 ?? null,
      lat: hqLat,
      lng: hqLng,
    },
  };

  const locations: Location[] = [];
  for (const e of data.locations.edges) {
    const n = e.node;
    if (!n.isActive) continue;
    if (n.showOnDisplay?.value === 'false') continue;
    let lat = n.address.latitude;
    let lng = n.address.longitude;
    if ((lat === null || lng === null) && n.address.countryCode) {
      const c = lookupCentroid(n.address.countryCode);
      if (c) {
        lng = c[0];
        lat = c[1];
      }
    }
    if (lat === null || lng === null) continue;
    locations.push({
      id: n.id,
      name: n.name,
      city: n.address.city,
      countryCode: n.address.countryCode,
      lat,
      lng,
      fulfillsOnlineOrders: n.fulfillsOnlineOrders,
    });
  }

  if (locations.length === 0 && shop.hq.lat !== null && shop.hq.lng !== null) {
    locations.push({
      id: 'shop-hq',
      name: `${shop.name} · HQ`,
      city: shop.hq.city,
      countryCode: shop.hq.countryCode,
      lat: shop.hq.lat,
      lng: shop.hq.lng,
      fulfillsOnlineOrders: true,
    });
  }

  return {shop, locations};
}
