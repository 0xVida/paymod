import type { CircleApiClient } from "./client.js";
import { encryptEntitySecret } from "./entity-secret.js";

/**
 * wire shape x402's `exact` scheme on EVM requires in the `PAYMENT-SIGNATURE` header's
 * `payload.authorization` field, per x402-foundation/x402's
 * `specs/schemes/exact/scheme_exact_evm.md` - field order matches ERC-3009's
 * `TransferWithAuthorization` struct exactly.
 */
export type Eip3009Authorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export type EvmExactPayload = {
  signature: string;
  authorization: Eip3009Authorization;
};

/**
 * ERC-3009's EIP-712 type definitions, byte-exact against the ERC text
 * (`ethereum/ERCs` `ERCS/erc-3009.md`) - every field is `uint256` except `from`/`to`
 * (`address`) and `nonce` (`bytes32`). a wrong type here silently recovers to the wrong
 * address instead of failing loudly.
 */
const EIP712_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

/**
 * builds and signs an EIP-3009 `TransferWithAuthorization` via Circle's `signTypedData`,
 * returning the payload x402's EVM `exact` scheme expects. `validAfter: 0` -
 * `validBefore` is bounded by the merchant's `maxTimeoutSeconds` since a facilitator
 * rejects an authorization outliving what it advertised.
 *
 * `nonce` is caller-supplied, derived deterministically from the payment's intent id
 * (same pattern as Stellar's x402 path), never random - `pay()` can be retried for the
 * same intent, and a random nonce would sign a second, independently payable
 * authorization for the same money instead of retrying the original.
 */
export async function signTransferAuthorization(params: {
  client: CircleApiClient;
  walletId: string;
  entitySecretHex: string;
  entityPublicKeyPem: string;
  chainId: number;
  tokenAddress: string;
  tokenName: string;
  tokenVersion: string;
  from: string;
  to: string;
  atomicAmount: string;
  maxTimeoutSeconds: number;
  nonce: string;
}): Promise<EvmExactPayload> {
  const authorization: Eip3009Authorization = {
    from: params.from,
    to: params.to,
    value: params.atomicAmount,
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + params.maxTimeoutSeconds),
    nonce: params.nonce,
  };

  const typedData = {
    types: EIP712_TYPES,
    domain: {
      name: params.tokenName,
      version: params.tokenVersion,
      chainId: params.chainId,
      verifyingContract: params.tokenAddress,
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  };

  const ciphertext = encryptEntitySecret(params.entitySecretHex, params.entityPublicKeyPem);
  const { signature } = await params.client.signTypedData({
    entitySecretCiphertext: ciphertext,
    walletId: params.walletId,
    data: JSON.stringify(typedData),
  });

  return { signature: signature.startsWith("0x") ? signature : `0x${signature}`, authorization };
}

/**
 * `authorizationState(address,bytes32) view returns (bool)` - selector `0xe94a0102`,
 * confirmed against 4byte.directory and a live call against the deployed Ethereum
 * Sepolia USDC contract. every EIP-3009 token exposes this, so it lets a caller check
 * whether an authorization was consumed without an indexer or facilitator API, used to
 * reconcile an `UNKNOWN` x402 outcome even when Paymod never saw a response.
 */
export async function isAuthorizationUsed(rpcUrl: string, tokenAddress: string, authorizer: string, nonce: string): Promise<boolean> {
  const paddedAuthorizer = authorizer.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const paddedNonce = nonce.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const data = `0xe94a0102${paddedAuthorizer}${paddedNonce}`;

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: tokenAddress, data }, "latest"] }),
  });
  const body = (await response.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(`eth_call to authorizationState failed: ${body.error.message}`);
  return body.result !== undefined && BigInt(body.result) !== 0n;
}
