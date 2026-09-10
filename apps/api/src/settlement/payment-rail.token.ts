/**
 * Rail-neutral DI token for whichever `PaymentRail` is active. Circle is the
 * only one bound today (`circle-rail.provider.ts`); Stellar's provider
 * (`stellar-rail.provider.ts`) stays in the repo, dormant, for a future
 * multi-chain expansion and can be bound to this same token later.
 */
export const PAYMENT_RAIL = Symbol("PAYMENT_RAIL");
