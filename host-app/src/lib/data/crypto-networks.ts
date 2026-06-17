/**
 * Crypto payout networks offered by the host-app.
 *
 * Each entry corresponds to a `method_type` accepted by the backend
 * (`PAY_METHODS` in supabase/functions/host/index.ts and the CHECK
 * constraint on host_payment_methods).
 *
 * `addressPattern` is a permissive regex used for client-side sanity
 * checking only — the canonical validation lives in the admin verification
 * step, not in client code.
 */

export interface CryptoNetwork {
  id: string;             // matches method_type
  token: string;          // displayed badge — "USDT", "BTC", "ETH"…
  chain: string;          // displayed chain — "Tron (TRC20)", "Bitcoin"
  shortLabel: string;     // grid card primary line — "USDT · TRC20"
  description: string;    // grid card hint line
  color: string;          // brand color hex
  accent: string;         // secondary color for gradient
  addressPattern: RegExp; // client-side sanity check (NOT authoritative)
  addressHint: string;    // human-readable hint shown next to the input
  supportsMemo: boolean;  // require/allow a tag/memo field (TON, etc.)
  memoLabel?: string;     // "Tag", "Memo", "Comment"
  examplePrefix: string;  // 4-6 char placeholder to anchor the user
}

export const NETWORKS: CryptoNetwork[] = [
  {
    id: "usdt_trc20", token: "USDT", chain: "Tron (TRC20)",
    shortLabel: "USDT · TRC20", description: "Cheapest USDT — instant Tron transfers",
    color: "#26A17B", accent: "#EF0027",
    addressPattern: /^T[A-Za-z1-9]{33}$/, addressHint: "Starts with T, 34 chars",
    supportsMemo: false, examplePrefix: "TXyz…",
  },
  {
    id: "usdt_erc20", token: "USDT", chain: "Ethereum (ERC20)",
    shortLabel: "USDT · ERC20", description: "USDT on Ethereum mainnet",
    color: "#26A17B", accent: "#627EEA",
    addressPattern: /^0x[a-fA-F0-9]{40}$/, addressHint: "0x… 42 chars",
    supportsMemo: false, examplePrefix: "0x…",
  },
  {
    id: "usdt_bep20", token: "USDT", chain: "BNB Smart Chain (BEP20)",
    shortLabel: "USDT · BEP20", description: "USDT on BNB Smart Chain",
    color: "#26A17B", accent: "#F0B90B",
    addressPattern: /^0x[a-fA-F0-9]{40}$/, addressHint: "0x… 42 chars",
    supportsMemo: false, examplePrefix: "0x…",
  },
  {
    id: "usdt_polygon", token: "USDT", chain: "Polygon",
    shortLabel: "USDT · Polygon", description: "USDT on Polygon mainnet",
    color: "#26A17B", accent: "#8247E5",
    addressPattern: /^0x[a-fA-F0-9]{40}$/, addressHint: "0x… 42 chars",
    supportsMemo: false, examplePrefix: "0x…",
  },
  {
    id: "btc", token: "BTC", chain: "Bitcoin",
    shortLabel: "Bitcoin", description: "Native BTC mainnet",
    color: "#F7931A", accent: "#FBC56C",
    addressPattern: /^(bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
    addressHint: "Starts with bc1, 1, or 3",
    supportsMemo: false, examplePrefix: "bc1…",
  },
  {
    id: "eth", token: "ETH", chain: "Ethereum",
    shortLabel: "Ethereum", description: "Native ETH mainnet",
    color: "#627EEA", accent: "#8FA5F3",
    addressPattern: /^0x[a-fA-F0-9]{40}$/, addressHint: "0x… 42 chars",
    supportsMemo: false, examplePrefix: "0x…",
  },
  {
    id: "trx", token: "TRX", chain: "Tron",
    shortLabel: "TRX (Tron)", description: "Native TRX",
    color: "#EF0027", accent: "#FF5773",
    addressPattern: /^T[A-Za-z1-9]{33}$/, addressHint: "Starts with T, 34 chars",
    supportsMemo: false, examplePrefix: "TXyz…",
  },
  {
    id: "bnb", token: "BNB", chain: "BNB Smart Chain",
    shortLabel: "BNB · BSC", description: "Native BNB on BSC",
    color: "#F0B90B", accent: "#FAD555",
    addressPattern: /^0x[a-fA-F0-9]{40}$/, addressHint: "0x… 42 chars",
    supportsMemo: false, examplePrefix: "0x…",
  },
  {
    id: "sol", token: "SOL", chain: "Solana",
    shortLabel: "Solana", description: "Native SOL mainnet",
    color: "#14F195", accent: "#9945FF",
    addressPattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
    addressHint: "Base58, 32-44 chars",
    supportsMemo: false, examplePrefix: "So…",
  },
  {
    id: "ton", token: "TON", chain: "The Open Network",
    shortLabel: "TON", description: "Toncoin",
    color: "#0098EA", accent: "#3CC4FF",
    addressPattern: /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/,
    addressHint: "EQ/UQ… 48 chars",
    supportsMemo: true, memoLabel: "Memo (optional)", examplePrefix: "EQ…",
  },
];

export const NETWORKS_BY_ID: Record<string, CryptoNetwork> = Object.fromEntries(
  NETWORKS.map((n) => [n.id, n]),
);

/**
 * Best-effort parse of a QR payload. Many wallets encode an EIP-681 / BIP-21
 * style URI ("ethereum:0x…", "bitcoin:bc1…?amount=…", "tron:T…"). We strip
 * any scheme prefix and query string so the user always ends up with a bare
 * address in the input field.
 */
export function parseAddressFromQr(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();
  const colon = s.indexOf(":");
  if (colon > 0 && colon < 20) s = s.slice(colon + 1);
  const q = s.indexOf("?");
  if (q > 0) s = s.slice(0, q);
  return s.trim();
}
