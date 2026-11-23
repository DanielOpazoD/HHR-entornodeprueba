const MASK_64 = 0xffffffffffffffffn;

const INITIAL_HASH = new BigUint64Array([
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n,
]);

const ROUND_CONSTANTS = new BigUint64Array([
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
]);

const rotr64 = (value: bigint, shift: bigint): bigint =>
  ((value >> shift) | (value << (64n - shift))) & MASK_64;

const padMessage = (input: Uint8Array): Uint8Array => {
  const paddedLength = Math.ceil((input.length + 17) / 128) * 128;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  const bitLength = BigInt(input.length) * 8n;
  view.setBigUint64(paddedLength - 16, bitLength >> 64n, false);
  view.setBigUint64(paddedLength - 8, bitLength & MASK_64, false);
  return padded;
};

/** Pure FIPS 180-4 SHA-384 digest returning the 48-byte hash without external dependencies. */
export const sha384Bytes = (input: Uint8Array): Uint8Array => {
  const padded = padMessage(input);
  const view = new DataView(padded.buffer);
  const hash = new BigUint64Array(INITIAL_HASH);
  const schedule = new BigUint64Array(80);

  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 16; i += 1) {
      schedule[i] = view.getBigUint64(offset + i * 8, false);
    }
    for (let i = 16; i < 80; i += 1) {
      const w15 = schedule.at(i - 15) ?? 0n;
      const w2 = schedule.at(i - 2) ?? 0n;
      const s0 = rotr64(w15, 1n) ^ rotr64(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr64(w2, 19n) ^ rotr64(w2, 61n) ^ (w2 >> 6n);
      schedule[i] = ((schedule.at(i - 16) ?? 0n) + s0 + (schedule.at(i - 7) ?? 0n) + s1) & MASK_64;
    }

    let a = hash.at(0) ?? 0n;
    let b = hash.at(1) ?? 0n;
    let c = hash.at(2) ?? 0n;
    let d = hash.at(3) ?? 0n;
    let e = hash.at(4) ?? 0n;
    let f = hash.at(5) ?? 0n;
    let g = hash.at(6) ?? 0n;
    let h = hash.at(7) ?? 0n;

    for (let i = 0; i < 80; i += 1) {
      const s1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & MASK_64 & g);
      const temp1 =
        (h + s1 + ch + (ROUND_CONSTANTS.at(i) ?? 0n) + (schedule.at(i) ?? 0n)) & MASK_64;
      const s0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) & MASK_64;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK_64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK_64;
    }

    hash[0] = ((hash.at(0) ?? 0n) + a) & MASK_64;
    hash[1] = ((hash.at(1) ?? 0n) + b) & MASK_64;
    hash[2] = ((hash.at(2) ?? 0n) + c) & MASK_64;
    hash[3] = ((hash.at(3) ?? 0n) + d) & MASK_64;
    hash[4] = ((hash.at(4) ?? 0n) + e) & MASK_64;
    hash[5] = ((hash.at(5) ?? 0n) + f) & MASK_64;
    hash[6] = ((hash.at(6) ?? 0n) + g) & MASK_64;
    hash[7] = ((hash.at(7) ?? 0n) + h) & MASK_64;
  }

  const output = new Uint8Array(48);
  const outView = new DataView(output.buffer);
  for (let i = 0; i < 6; i += 1) {
    outView.setBigUint64(i * 8, hash.at(i) ?? 0n, false);
  }
  return output;
};

/** Pure FIPS 180-4 SHA-384 lowercase hexadecimal digest of a UTF-8 string. */
export const sha384Hex = (value: string): string =>
  Array.from(sha384Bytes(new TextEncoder().encode(value)), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
