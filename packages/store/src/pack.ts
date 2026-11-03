import type { Derived, Origin, Review, TranslationRecord } from '@diglot/core'
import { parseRecord } from '@diglot/core'
import { builtin } from './builtin.ts'

/** `zstd` is faster and smaller, but only available where `node:zlib` supports it. */
export type RecordsCompression = 'gzip' | 'zstd' | 'none'

export interface EncodeRecordsOptions {
  /** How the packed records are compressed before base64 encoding. Defaults to `gzip`. */
  compression?: RecordsCompression
}

const ORIGINS: Origin[] = ['mt', 'tm', 'human']
const REVIEWS: Review[] = ['none', 'edited', 'verified', 'rejected']
const DERIVED: Derived[] = ['fresh', 'carry', 'update']

/** Base64 of the first three bytes of each format's magic number. */
const GZIP_BASE64 = 'H4sI'
const ZSTD_BASE64 = 'KLUv'
const VERSION = 1
const COLUMNS = 15
/** hash, source, text, flags, updatedAt. */
const REQUIRED_COLUMNS = 5

/**
 * Serialises translation records, keyed by hash, into one string for a cache. Records are packed
 * into columns with repeated values (models, logins, timestamps) interned, then compressed and
 * base64-encoded unless `compression` is `none`. Values that fail `parseRecord` or whose hash
 * differs from their key are left out.
 */
export async function encodeRecords(records: ReadonlyMap<string, unknown> | Record<string, unknown>, options: EncodeRecordsOptions = {}): Promise<string> {
  const strings: string[] = []
  const ids = new Map<string, number>()
  const intern = (value: string | undefined): number => {
    if (value === undefined)
      return 0
    let id = ids.get(value)
    if (id === undefined) {
      strings.push(value)
      ids.set(value, id = strings.length)
    }
    return id
  }
  const columns: unknown[][] = Array.from({ length: COLUMNS }, () => [])
  const entries = records instanceof Map ? records.entries() : Object.entries(records)
  for (const [hash, value] of entries) {
    let record: TranslationRecord
    try {
      record = parseRecord(value)
    }
    catch {
      continue
    }
    if (record.hash !== hash)
      continue
    const { mt } = record
    columns[0]!.push(record.hash)
    columns[1]!.push(record.source)
    columns[2]!.push(record.text)
    columns[3]!.push(ORIGINS.indexOf(record.origin) + 3 * REVIEWS.indexOf(record.review) + 12 * DERIVED.indexOf(record.derived))
    columns[4]!.push(intern(record.updatedAt))
    columns[5]!.push(record.prev ?? 0)
    columns[6]!.push(record.salt ?? 0)
    columns[7]!.push(mt ? intern(mt.model) : 0)
    columns[8]!.push(mt ? mt.candidate === record.text ? 0 : mt.candidate : 0)
    columns[9]!.push(intern(mt?.promptVersion))
    columns[10]!.push(intern(record.by))
    columns[11]!.push(intern(record.verifiedBy?.by))
    columns[12]!.push(intern(record.verifiedBy?.at))
    columns[13]!.push(intern(record.rejectedBy?.by))
    columns[14]!.push(intern(record.rejectedBy?.at))
  }
  const json = JSON.stringify({ version: VERSION, strings, columns: columns.map((column, i) => i < REQUIRED_COLUMNS || column.some(value => value !== 0) ? column : []) })
  const compression = options.compression ?? 'gzip'
  return compression === 'none' ? json : base64(await compress(json, compression))
}

/** Reads records written by `encodeRecords`, keyed by hash. Throws on anything else. */
export async function decodeRecords(data: string): Promise<Map<string, TranslationRecord>> {
  const { hashes, record } = await readPack(data)
  const out = new Map<string, TranslationRecord>()
  for (let row = 0; row < hashes.length; row++)
    out.set(hashes[row]!, record(row))
  if (out.size !== hashes.length)
    throw new Error('malformed records pack')
  return out
}

/**
 * Reads records written by `encodeRecords` into a read-only map keyed by hash, building each
 * record on first access and returning the same object afterwards. Rejects when `data` is not a
 * records pack; reading a malformed record throws.
 */
export async function decodeRecordsView(data: string): Promise<ReadonlyMap<string, TranslationRecord>> {
  return new RecordsView(await readPack(data))
}

interface Pack {
  hashes: string[]
  record: (row: number) => TranslationRecord
}

async function readPack(data: string): Promise<Pack> {
  const compression = data.startsWith(GZIP_BASE64) ? 'gzip' : data.startsWith(ZSTD_BASE64) ? 'zstd' : undefined
  const json = compression ? await decompress(fromBase64(data), compression) : data
  const pack = JSON.parse(json) as { version?: unknown, strings?: unknown, columns?: unknown }
  if (!pack || pack.version !== VERSION || !Array.isArray(pack.strings) || !Array.isArray(pack.columns) || pack.columns.length !== COLUMNS || !pack.columns.every(Array.isArray))
    throw new Error('unsupported records pack')
  const strings = pack.strings as unknown[]
  if (!strings.every(value => typeof value === 'string'))
    throw new Error('malformed records pack')
  const columns = pack.columns as unknown[][]
  const [hashes, sources, texts, flagsColumn, updated, prevs, salts, models, candidates, versions, bys, verifiers, verified, rejecters, rejected] = columns as [unknown[], ...unknown[][]]
  for (let i = 1; i < COLUMNS; i++) {
    if (columns[i]!.length !== hashes.length && (i < REQUIRED_COLUMNS || columns[i]!.length !== 0))
      throw new Error('malformed records pack')
  }
  for (let row = 0; row < hashes.length; row++) {
    if (typeof hashes[row] !== 'string')
      malformed(row)
  }
  const string = (column: unknown[], row: number): string => {
    const id = column[row]
    const value = typeof id === 'number' ? strings[id - 1] : undefined
    return typeof value === 'string' ? value : malformed(row)
  }
  const inline = (column: unknown[], row: number): string => {
    const value = column[row]
    return typeof value === 'string' ? value : malformed(row)
  }
  const record = (row: number): TranslationRecord => {
    const source = sources![row]
    const text = texts![row]
    const flags = flagsColumn![row]
    if (typeof source !== 'string' || typeof text !== 'string' || typeof flags !== 'number' || !Number.isInteger(flags) || flags < 0 || flags >= 36)
      malformed(row)
    const record = {
      hash: hashes[row] as string,
      source,
      text,
      origin: ORIGINS[flags % 3]!,
      review: REVIEWS[Math.floor(flags / 3) % 4]!,
      derived: DERIVED[Math.floor(flags / 12)]!,
    } as TranslationRecord
    if (prevs![row])
      record.prev = inline(prevs!, row)
    if (salts![row])
      record.salt = inline(salts!, row)
    if (models![row]) {
      const model = string(models!, row)
      const value = candidates![row]
      const candidate = typeof value === 'string' ? value : value ? malformed(row) : text
      record.mt = versions![row] ? { model, promptVersion: string(versions!, row), candidate } : { model, candidate }
    }
    if (bys![row])
      record.by = string(bys!, row)
    if (verifiers![row])
      record.verifiedBy = { by: string(verifiers!, row), at: string(verified!, row) }
    if (rejecters![row])
      record.rejectedBy = { by: string(rejecters!, row), at: string(rejected!, row) }
    record.updatedAt = string(updated!, row)
    return record
  }
  return { hashes: hashes as string[], record }
}

function malformed(row: number): never {
  throw new Error(`malformed records pack at row ${row}`)
}

class RecordsView implements ReadonlyMap<string, TranslationRecord> {
  readonly #record: (row: number) => TranslationRecord
  readonly #entries = new Map<string, number | TranslationRecord>()

  constructor({ hashes, record }: Pack) {
    this.#record = record
    for (let row = 0; row < hashes.length; row++)
      this.#entries.set(hashes[row]!, row)
    if (this.#entries.size !== hashes.length)
      throw new Error('malformed records pack')
  }

  get size(): number {
    return this.#entries.size
  }

  has(hash: string): boolean {
    return this.#entries.has(hash)
  }

  get(hash: string): TranslationRecord | undefined {
    const entry = this.#entries.get(hash)
    return entry === undefined ? undefined : this.#resolve(hash, entry)
  }

  keys(): MapIterator<string> {
    return this.#entries.keys()
  }

  * values(): MapIterator<TranslationRecord> {
    for (const [hash, entry] of this.#entries)
      yield this.#resolve(hash, entry)
  }

  * entries(): MapIterator<[string, TranslationRecord]> {
    for (const [hash, entry] of this.#entries)
      yield [hash, this.#resolve(hash, entry)]
  }

  [Symbol.iterator](): MapIterator<[string, TranslationRecord]> {
    return this.entries()
  }

  forEach(callback: (value: TranslationRecord, key: string, map: ReadonlyMap<string, TranslationRecord>) => void, thisArg?: unknown): void {
    for (const [hash, entry] of this.#entries)
      callback.call(thisArg, this.#resolve(hash, entry), hash, this)
  }

  #resolve(hash: string, entry: number | TranslationRecord): TranslationRecord {
    if (typeof entry !== 'number')
      return entry
    const record = this.#record(entry)
    this.#entries.set(hash, record)
    return record
  }
}

type Zlib = typeof import('node:zlib')
type NodeBuffer = typeof import('node:buffer').Buffer

async function compress(text: string, compression: 'gzip' | 'zstd'): Promise<Uint8Array> {
  const zlib = builtin<Zlib>('node:zlib')
  if (compression === 'zstd') {
    if (!zlib?.zstdCompressSync)
      throw new Error('zstd compression needs node:zlib with zstd support')
    return zlib.zstdCompressSync(text, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 } })
  }
  if (zlib)
    return zlib.gzipSync(text, { level: 1 })
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}

async function decompress(bytes: Uint8Array, compression: 'gzip' | 'zstd'): Promise<string> {
  const zlib = builtin<Zlib>('node:zlib')
  if (compression === 'zstd') {
    if (!zlib?.zstdDecompressSync)
      throw new Error('zstd decompression needs node:zlib with zstd support')
    return zlib.zstdDecompressSync(bytes).toString('utf8')
  }
  if (zlib)
    return zlib.gunzipSync(bytes).toString('utf8')
  return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

function base64(bytes: Uint8Array): string {
  const buffer = builtin<{ Buffer: NodeBuffer }>('node:buffer')?.Buffer
  if (buffer)
    return buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(data: string): Uint8Array {
  const buffer = builtin<{ Buffer: NodeBuffer }>('node:buffer')?.Buffer
  if (buffer)
    return buffer.from(data, 'base64')
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)
  return bytes
}
