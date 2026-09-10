import { StrKey } from "@stellar/stellar-sdk";

/** A classic account (G...) or a contract address (C...). */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

/** payments in this system always target a classic account, never a contract. */
export function isValidPaymentDestination(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}
