const PRIMES: number[] = []
for (let n = 2; PRIMES.length < 64; n++) {
  if (PRIMES.every(p => n % p))
    PRIMES.push(n)
}

/** FIPS 180-4 constants: the first 32 bits of the fractional parts of square and cube roots of primes. */
const fraction = (root: number) => (root % 1) * 0x100000000 | 0
const IV = new Int32Array(PRIMES.slice(0, 8).map(p => fraction(Math.sqrt(p))))
const K = new Int32Array(PRIMES.map(p => fraction(Math.cbrt(p))))

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
const encoder = new TextEncoder()
const W = new Int32Array(64)
const H = new Int32Array(8)
let buffer = new Uint8Array(256)

/** Hex sha256 of the UTF-8 encoding of `input`. */
export function sha256(input: string): string {
  if (buffer.length < input.length * 3 + 72)
    buffer = new Uint8Array(input.length * 3 + 72)
  const length = encoder.encodeInto(input, buffer).written
  const total = Math.ceil((length + 9) / 64) * 64
  buffer.fill(0, length, total)
  buffer[length] = 0x80
  const bits = length * 8
  buffer[total - 5] = Math.floor(bits / 0x100000000)
  buffer[total - 4] = bits >>> 24
  buffer[total - 3] = bits >>> 16
  buffer[total - 2] = bits >>> 8
  buffer[total - 1] = bits

  H.set(IV)
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4
      W[i] = (buffer[j]! << 24) | (buffer[j + 1]! << 16) | (buffer[j + 2]! << 8) | buffer[j + 3]!
    }
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!
      const w2 = W[i - 2]!
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0
    }
    let a = H[0]!
    let b = H[1]!
    let c = H[2]!
    let d = H[3]!
    let e = H[4]!
    let f = H[5]!
    let g = H[6]!
    let h = H[7]!
    for (let i = 0; i < 64; i++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const t1 = (h + s1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    H[0] = H[0]! + a
    H[1] = H[1]! + b
    H[2] = H[2]! + c
    H[3] = H[3]! + d
    H[4] = H[4]! + e
    H[5] = H[5]! + f
    H[6] = H[6]! + g
    H[7] = H[7]! + h
  }
  let hex = ''
  for (let i = 0; i < 8; i++) {
    const word = H[i]!
    hex += HEX[word >>> 24]! + HEX[(word >>> 16) & 0xFF]! + HEX[(word >>> 8) & 0xFF]! + HEX[word & 0xFF]!
  }
  return hex
}
