declare module "bs58" {
  function encode(source: Uint8Array | Buffer): string;
  function decode(source: string): Uint8Array;
  function decodeUnsafe(source: string): Uint8Array | undefined;
  const bs58: { encode: typeof encode; decode: typeof decode; decodeUnsafe: typeof decodeUnsafe };
  export default bs58;
}
