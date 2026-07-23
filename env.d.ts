/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  /**
   * Custom environment variables for the live-display wall.
   * Set these on the Hydrogen storefront (admin → Hydrogen → Storefront
   * settings → Environments & variables) or in .env for local dev.
   */
  interface Env {
    /** Dev Dashboard app client ID. Used with the client secret to mint
     *  Admin API access tokens via the OAuth client credentials grant
     *  (tokens expire after 24 h; the client re-mints automatically). */
    SHOPIFY_API_KEY: string;
    /** Dev Dashboard app client secret. Mark as secret on Oxygen. */
    SHOPIFY_API_SECRET: string;
    /** Admin GraphQL API version. Defaults to 2026-07. */
    SHOPIFY_ADMIN_API_VERSION?: string;
    /** Currency code shown on the wall. Defaults to CAD. */
    DISPLAY_CURRENCY?: string;
    /** Override the shop domain for Admin API calls. Defaults to
     *  PUBLIC_STORE_DOMAIN (injected by Oxygen). */
    ADMIN_SHOP_DOMAIN?: string;
    /** Optional shared secret. When set, `/` and `/api/snapshot` require
     *  ?key=<token> (or the cookie the kiosk page sets). */
    KIOSK_TOKEN?: string;
  }
}
