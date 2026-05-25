/**
 * Plain constants shared between client components and the "use server"
 * actions module. Non-function exports cannot live in a "use server" file —
 * Next.js replaces them with server-action references in the client bundle,
 * breaking things like `SUPPORTED_CURRENCIES.map(...)` at render time.
 */

export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "AED", "SAR", "TRY", "IRR",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
