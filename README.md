# Live Sales Display for Shopify

A real-time "live sales" wall for your store, built on Hydrogen and
hosted on Oxygen (included with every paid Shopify plan). It shows
rolling 24-hour revenue, orders, units sold, active sessions and carts,
top-selling products, and a rotating globe with your retail locations
and an animated arc for every incoming order.

No servers, no database, no webhooks. The app polls your own Shopify
admin via ShopifyQL (the same backend as the admin Live View) every
~20 seconds and renders the result. Everything on screen comes from
your admin; point it at any store and it adapts.

```
Display ── 20 s poll ──►  Hydrogen (Oxygen)  ──►  Admin GraphQL
                          /api/snapshot            (ShopifyQL)
```

## Requirements

- A Shopify store on a paid plan (Oxygen isn't available on trials or
  dev stores)
- Access to the [Dev Dashboard](https://dev.shopify.com/dashboard) for
  the organization that owns your store
- Node.js 22+ and [pnpm](https://pnpm.io) (or npm) for local setup

## 1. Create the app in the Dev Dashboard

1. Open the [Dev Dashboard](https://dev.shopify.com/dashboard) and make
   sure you're in the organization that owns your store. This matters:
   the app authenticates with the client credentials grant, which only
   works when app and store are in the same organization.
2. Go to **Apps → Create app** and name it (e.g. "Live Display").
3. Set the app's access scopes to:
   `read_reports, read_customers, read_products, read_locations`
4. Configure **Protected customer data** access (in the app's API
   access settings). ShopifyQL queries require it alongside
   `read_reports` — without it the snapshot endpoint returns errors.
5. On the app's **Settings** page, copy the **Client ID** and
   **Secret**. Keep the secret out of your repo.

## 2. Install the app on your store

From the Dev Dashboard, install the app on the store you want the wall
to read from. No further in-admin setup is needed — the app has no
embedded UI.

## 3. Run it locally

```bash
git clone <this repo> && cd <this repo>
pnpm install
cp .env.example .env   # fill in client ID, secret, and shop domain
pnpm dev
```

Open http://localhost:3000. If you see live numbers, auth and scopes
are set up correctly.

## 4. Deploy to Oxygen

1. Push your fork of this repo to GitHub.
2. In your Shopify admin, install the **Hydrogen** sales channel and
   create a storefront connected to that GitHub repo. Merge the
   auto-opened PR that adds the Oxygen deploy workflow; every push then
   deploys automatically. (Alternative: `npx shopify hydrogen deploy`.)
3. In **Hydrogen → Storefront settings → Environments and variables**,
   set the variables from `.env.example` for the production
   environment. Mark `SHOPIFY_API_SECRET` as secret.
4. Open the deployment URL on your display. Any number of screens can
   point at it; they share one cached snapshot per 20-second window.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `SHOPIFY_API_KEY` | yes | Dev Dashboard app client ID |
| `SHOPIFY_API_SECRET` | yes | Dev Dashboard app client secret |
| `ADMIN_SHOP_DOMAIN` | yes | Shop the data comes from, e.g. `your-store.myshopify.com` |
| `DISPLAY_CURRENCY` | no | Currency code shown on the wall (default `CAD`) |
| `SHOPIFY_ADMIN_API_VERSION` | no | Admin API version (default `2026-07`) |
| `KIOSK_TOKEN` | no | Shared secret; when set, the wall requires `?key=<token>` |
| `SESSION_SECRET` | yes | Any random string (cookie signing) |

Useful URL parameters for the display itself: `?tz=America/Toronto`
(display timezone), `?bg=transparent` (LED panels), `?globe=textured`
(pre-rendered Earth on stronger hardware), `?renderer=webgl|webgpu`
(3D globe; the hardware-safe vector globe is the default).

## Notes

- Access tokens are minted at runtime from the client ID and secret and
  expire after 24 hours; nothing is stored.
- If token requests fail with `shop_not_permitted`, the app and store
  are not in the same Dev Dashboard organization.
- If you set `KIOSK_TOKEN`, open the wall once with `?key=<token>`; a
  cookie keeps subsequent polls authorized.
