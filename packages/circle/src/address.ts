const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * format validation only, not EIP-55 checksum validation (that requires
 * keccak256, an extra dependency not otherwise needed by this package).
 * a malformed address is still rejected here - an address with a wrong but
 * correctly-shaped checksum isn't caught until Circle's own API rejects it.
 */
export function isValidEvmAddress(address: string): boolean {
  return EVM_ADDRESS_PATTERN.test(address);
}
