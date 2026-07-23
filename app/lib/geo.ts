// ─────────────────────────────────────────────────────────────────────
//  Country centroid lookup — used to plot order pulses on the globe
//  when a city-level coordinate isn't available from the address.
//
//  Coords are approximate population-weighted centroids; sufficient
//  for a stylised globe at this zoom. Covers roughly the top 60
//  ecommerce shipping destinations.
// ─────────────────────────────────────────────────────────────────────

const CENTROIDS: Record<string, [number, number]> = {
  CA: [-79.38,  43.65],   AT: [16.37,  48.21],   AU: [149.13, -35.28],
  US: [-95.71,  37.09],   BE: [ 4.35,  50.85],   NZ: [174.77, -41.29],
  GB: [ -0.13,  51.51],   CH: [ 8.54,  47.37],   AE: [ 55.27,  25.20],
  FR: [  2.35,  48.86],   SE: [18.07,  59.33],   SG: [103.82,   1.35],
  DE: [ 13.40,  52.52],   NO: [10.75,  59.91],   HK: [114.17,  22.32],
  IT: [ 12.49,  41.90],   DK: [12.57,  55.68],   CN: [116.40,  39.90],
  ES: [ -3.70,  40.42],   FI: [24.94,  60.17],   JP: [139.69,  35.69],
  NL: [  4.90,  52.37],   IE: [-6.26,  53.35],   KR: [126.98,  37.57],
  PT: [ -9.14,  38.72],   PL: [21.01,  52.23],   TW: [121.56,  25.04],
  IS: [-21.94,  64.13],   CZ: [14.42,  50.09],   IN: [ 77.21,  28.61],
  GR: [ 23.73,  37.98],   MX: [-99.13,  19.43],  TH: [100.50,  13.76],
  RU: [ 37.62,  55.75],   BR: [-46.63, -23.55],  MY: [101.69,   3.14],
  TR: [ 32.86,  39.93],   AR: [-58.38, -34.61],  ID: [106.85,  -6.21],
  IL: [ 34.78,  32.08],   CL: [-70.65, -33.45],  ZA: [ 28.05, -26.20],
  SA: [ 46.68,  24.71],   CO: [-74.07,   4.71],  EG: [ 31.24,  30.04],
  KW: [ 47.97,  29.38],   PE: [-77.04, -12.05],
};

export function lookupCentroid(country: string | null | undefined): [number, number] | null {
  if (!country) return null;
  return CENTROIDS[country.toUpperCase()] ?? null;
}

// ─────────────────────────────────────────────────────────────────────
//  Country NAME → ISO 3166-1 alpha-2 code.
//
//  ShopifyQL's `shipping_country` dimension returns full English
//  country names ("Canada", "United States"), but the kiosk feeds
//  region codes to Intl.DisplayNames and the centroid table above is
//  keyed by code. Build the reverse map from the runtime's own CLDR
//  data so it matches whatever the display layer resolves, plus a few
//  aliases for spellings Shopify uses that differ from CLDR.
// ─────────────────────────────────────────────────────────────────────

const ISO_CODES =
  ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
   "BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
   "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
   "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC " +
   "LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA " +
   "NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
   "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO " +
   "TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW").split(" ");

const ALIASES: Record<string, string> = {
  "united states of america": "US",
  "usa": "US",
  "united kingdom of great britain and northern ireland": "GB",
  "uk": "GB",
  "korea, republic of": "KR",
  "republic of korea": "KR",
  "korea, democratic people's republic of": "KP",
  "russian federation": "RU",
  "czech republic": "CZ",
  "turkey": "TR",
  "türkiye": "TR",
  "hong kong sar": "HK",
  "hong kong sar china": "HK",
  "macao sar": "MO",
  "macao sar china": "MO",
  "taiwan, province of china": "TW",
  "viet nam": "VN",
  "united arab emirates (the)": "AE",
  "netherlands (the)": "NL",
  "philippines (the)": "PH",
  "côte d'ivoire": "CI",
  "ivory coast": "CI",
  "myanmar (burma)": "MM",
  "congo, the democratic republic of the": "CD",
  "congo - kinshasa": "CD",
  "congo - brazzaville": "CG",
  "palestinian territories": "PS",
  "st. lucia": "LC",
  "st. kitts & nevis": "KN",
  "st. vincent & grenadines": "VC",
  "são tomé & príncipe": "ST",
  "trinidad & tobago": "TT",
  "bosnia & herzegovina": "BA",
  "antigua & barbuda": "AG",
};

let codeByName: Map<string, string> | null = null;

function buildReverseMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of ISO_CODES) {
      const name = names.of(code);
      if (name && name !== code) map.set(name.toLowerCase(), code);
    }
  } catch {
    // No ICU region data in this runtime — aliases below still cover
    // the high-volume countries, and unknown names are skipped.
  }
  for (const [name, code] of Object.entries(ALIASES)) map.set(name, code);
  return map;
}

/**
 * Resolve a country value from ShopifyQL to an ISO-2 code.
 * Accepts a full English name or an already-coded 2-letter value.
 * Returns null for unknown names (callers skip those rows).
 */
export function countryToCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  if (!codeByName) codeByName = buildReverseMap();
  return codeByName.get(trimmed.toLowerCase()) ?? null;
}
