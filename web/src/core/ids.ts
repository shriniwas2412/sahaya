// ULID (https://github.com/ulid/spec): 48-bit ms time + 80 random bits, Crockford base32.
// Sorts by creation time; no coordination between devices needed.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now: number = Date.now(), rand: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  let t = "";
  let ms = now;
  for (let i = 0; i < 10; i++) {
    t = ALPHABET[ms % 32] + t;
    ms = Math.floor(ms / 32);
  }
  let r = "";
  let acc = 0, bits = 0;
  for (const byte of rand) {
    acc = ((acc & ((1 << bits) - 1)) << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      r += ALPHABET[(acc >> bits) & 31];
    }
  }
  return t + r.slice(0, 16);
}
