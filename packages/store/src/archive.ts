import type { PolicySnapshot } from '@diglot/core'
import type { Manifest } from './manifest.ts'
import { builtin } from './builtin.ts'

/** The files of a store read from an archive of its repository. */
export interface StoreArchive {
  /** Commit the archive was made from, from the `comment` of its pax global header (as GitHub writes it). */
  sha?: string
  /** Record values by locale, then hash, as parsed JSON. Only their `hash` is checked: read them with `parseRecord`. */
  records: Map<string, Map<string, unknown>>
  /** Source manifests by source name. */
  manifests: Map<string, Manifest>
  /** The policy snapshot in `.diglot/policy.json`, as parsed JSON. Read it with `restorePolicy`. */
  policy?: PolicySnapshot
  /** Text of the YAML files at the root and in each locale directory (`glossary.yml`, `fr/locale.yml`), by path. */
  files: Map<string, string>
  /** Paths of records, manifests and the policy snapshot that were skipped: not valid JSON, a record whose `hash` differs from its file name, or a manifest of another version. */
  invalid: string[]
}

export interface ReadArchiveOptions {
  /** Only read records of these locales. */
  locales?: string[]
  /** Only read these manifests, by source name. */
  manifests?: string[]
}

/** An archive as bytes or a stream of bytes, such as a `fetch` response body. */
export type ArchiveInput = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer

const RECORD_RE = /^([^/]+)\/segments\/([0-9a-f]{2})\/([0-9a-f]{16})\.json$/
const MANIFEST_RE = /^\.diglot\/manifest\/([^/]+)\.json$/
const POLICY_PATH = '.diglot/policy.json'
const TEXT_RE = /^(?:[^/]+\/)?[^/]+\.ya?ml$/

const BLOCK = 512
const decoder = new TextDecoder()

type Kind = { type: 'record', locale: string, hash: string } | { type: 'manifest', source: string } | { type: 'policy' } | { type: 'text' }

/**
 * Reads the records, manifests and YAML files of a store from a `tar` or `tar.gz` archive of its
 * repository, such as GitHub's `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>`. Every
 * entry sits under one top-level directory, which is dropped. Streams are read as they arrive and
 * only the files of the store are kept.
 */
export async function readArchive(input: ArchiveInput, options: ReadArchiveOptions = {}): Promise<StoreArchive> {
  const archive: StoreArchive = { records: new Map(), manifests: new Map(), files: new Map(), invalid: [] }
  const locales = options.locales && new Set(options.locales)
  const manifests = options.manifests && new Set(options.manifests)

  const classify = (path: string): Kind | undefined => {
    const record = RECORD_RE.exec(path)
    if (record)
      return record[3]!.startsWith(record[2]!) && (!locales || locales.has(record[1]!)) ? { type: 'record', locale: record[1]!, hash: record[3]! } : undefined
    const manifest = MANIFEST_RE.exec(path)
    if (manifest)
      return !manifests || manifests.has(manifest[1]!) ? { type: 'manifest', source: manifest[1]! } : undefined
    if (path === POLICY_PATH)
      return { type: 'policy' }
    if (TEXT_RE.test(path))
      return { type: 'text' }
  }

  const accept = (path: string, kind: Kind, data: Uint8Array) => {
    const text = decoder.decode(data)
    if (kind.type === 'text') {
      archive.files.set(path, text)
      return
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    }
    catch {
      archive.invalid.push(path)
      return
    }
    if (kind.type === 'policy') {
      archive.policy = value as PolicySnapshot
      return
    }
    if (kind.type === 'manifest') {
      if ((value as Manifest | null)?.version === 1 && typeof (value as Manifest).files === 'object')
        archive.manifests.set(kind.source, value as Manifest)
      else
        archive.invalid.push(path)
      return
    }
    if ((value as { hash?: unknown } | null)?.hash !== kind.hash) {
      archive.invalid.push(path)
      return
    }
    let byHash = archive.records.get(kind.locale)
    if (!byHash)
      archive.records.set(kind.locale, byHash = new Map())
    byHash.set(kind.hash, value)
  }

  const parser = createTarParser((name) => {
    const slash = name.indexOf('/')
    const path = slash < 0 ? '' : name.slice(slash + 1)
    const kind = path ? classify(path) : undefined
    return kind && (data => accept(path, kind, data))
  }, (sha) => {
    archive.sha = sha
  })

  for await (const chunk of decompress(input))
    parser.push(chunk)
  parser.end()
  return archive
}

/** Bytes of a `tar.gz` or `tar` archive, decompressed as they arrive. */
async function* decompress(input: ArchiveInput): AsyncGenerator<Uint8Array> {
  const source = input instanceof ReadableStream ? input : new Blob([input as Uint8Array<ArrayBuffer>]).stream()
  const reader = source.getReader()
  let first = await reader.read()
  while (!first.done && first.value.length < 2) {
    const next = await reader.read()
    if (next.done)
      break
    first = { done: false, value: concat([first.value, next.value], first.value.length + next.value.length) }
  }
  if (first.done)
    return
  const gzip = first.value[0] === 0x1F && first.value[1] === 0x8B
  if (!gzip) {
    yield first.value
    for (let next = await reader.read(); !next.done; next = await reader.read())
      yield next.value
    return
  }
  const zlib = builtin<typeof import('node:zlib')>('node:zlib')
  if (zlib) {
    yield* nodeGunzip(zlib, first.value, reader)
    return
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value!)
    },
    async pull(controller) {
      const next = await reader.read()
      if (next.done)
        controller.close()
      else
        controller.enqueue(next.value)
    },
    cancel: reason => reader.cancel(reason),
  }).pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  const output = stream.getReader()
  for (let next = await output.read(); !next.done; next = await output.read())
    yield next.value
}

async function* nodeGunzip(zlib: typeof import('node:zlib'), first: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Uint8Array> {
  const gunzip = zlib.createGunzip({ chunkSize: 1 << 22 })
  const ready: Uint8Array[] = []
  let failure: unknown
  let ended = false
  let wake: (() => void) | undefined
  const notify = () => {
    wake?.()
    wake = undefined
  }
  gunzip.on('data', (chunk: Uint8Array) => {
    ready.push(chunk)
    notify()
  })
  gunzip.on('error', (error) => {
    failure = error
    notify()
  })
  gunzip.on('end', () => {
    ended = true
    notify()
  })
  // Input that arrives during a write is coalesced into the next, so inflating overlaps with parsing.
  const pending: Uint8Array[] = []
  let size = 0
  let writing = false
  let received = false
  const pump = () => {
    if (writing || failure)
      return
    if (pending.length) {
      const chunk = pending.length === 1 ? pending[0]! : concat(pending, size)
      pending.length = 0
      size = 0
      writing = true
      gunzip.write(chunk, () => {
        writing = false
        pump()
      })
    }
    else if (received) {
      gunzip.end()
    }
  }
  const feed = (async () => {
    try {
      pending.push(first)
      size = first.length
      pump()
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        pending.push(next.value)
        size += next.value.length
        pump()
      }
      received = true
      pump()
    }
    catch (error) {
      failure = error
      gunzip.destroy()
      notify()
    }
  })()
  while (true) {
    while (ready.length)
      yield ready.shift()!
    if (failure) {
      reader.cancel(failure).catch(() => {})
      throw failure
    }
    if (ended)
      break
    await new Promise<void>(resolve => wake = resolve)
  }
  await feed
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * An incremental `tar` reader. `select` is called with the path of each regular file and returns a
 * handler for its body, or nothing to skip it. pax and GNU long names are supported.
 */
function createTarParser(select: (name: string) => ((data: Uint8Array) => void) | undefined, onSha: (sha: string) => void) {
  const partial = new Uint8Array(BLOCK)
  let headerFill = 0
  let remaining = 0
  let padding = 0
  let body: Uint8Array | undefined
  let bodyFill = 0
  let handler: ((data: Uint8Array) => void) | undefined
  let longName: string | undefined
  let finished = false

  const finishBody = () => {
    if (handler && body)
      handler(body)
    handler = undefined
    body = undefined
  }

  const startEntry = (header: Uint8Array) => {
    if (header[0] === 0 && header[148] === 0) {
      finished = true
      return
    }
    if (!isUstar(header))
      throw new Error('invalid tar header')
    const size = readSize(header)
    const type = header[156]
    padding = (BLOCK - (size % BLOCK)) % BLOCK
    remaining = size
    body = undefined
    bodyFill = 0
    handler = undefined
    if (type === 0x78 || type === 0x67 || type === 0x4C) {
      handler = (data) => {
        if (type === 0x4C) {
          longName = readString(data, 0, data.length)
          return
        }
        const fields = parsePax(data)
        if (type === 0x78 && fields.path !== undefined)
          longName = fields.path
        if (type === 0x67 && fields.comment && /^[0-9a-f]{40}$/.test(fields.comment))
          onSha(fields.comment)
      }
    }
    else {
      const name = longName ?? entryName(header)
      longName = undefined
      if (type === 0x30 || type === 0)
        handler = select(name)
    }
    if (remaining === 0) {
      handler?.(new Uint8Array(0))
      handler = undefined
    }
  }

  return {
    push(chunk: Uint8Array) {
      let offset = 0
      while (offset < chunk.length) {
        if (finished)
          return
        if (remaining > 0) {
          const take = Math.min(remaining, chunk.length - offset)
          if (handler && !body) {
            if (take === remaining) {
              const data = chunk.subarray(offset, offset + take)
              remaining = 0
              offset += take
              const done = handler
              handler = undefined
              done(data)
              continue
            }
            body = new Uint8Array(remaining)
          }
          if (body)
            body.set(chunk.subarray(offset, offset + take), bodyFill)
          bodyFill += take
          remaining -= take
          offset += take
          if (remaining === 0)
            finishBody()
          continue
        }
        if (padding > 0) {
          const skip = Math.min(padding, chunk.length - offset)
          padding -= skip
          offset += skip
          continue
        }
        if (headerFill === 0 && chunk.length - offset >= BLOCK) {
          offset += BLOCK
          startEntry(chunk.subarray(offset - BLOCK, offset))
          continue
        }
        const take = Math.min(BLOCK - headerFill, chunk.length - offset)
        partial.set(chunk.subarray(offset, offset + take), headerFill)
        headerFill += take
        offset += take
        if (headerFill === BLOCK) {
          headerFill = 0
          startEntry(partial)
        }
      }
    },
    end() {
      if (!finished)
        throw new Error('archive is truncated')
    },
  }
}

function readString(bytes: Uint8Array, start: number, end: number): string {
  let stop = start
  while (stop < end && bytes[stop] !== 0)
    stop++
  return decoder.decode(bytes.subarray(start, stop))
}

function isUstar(header: Uint8Array): boolean {
  return header[257] === 0x75 && header[258] === 0x73 && header[259] === 0x74 && header[260] === 0x61 && header[261] === 0x72
}

function entryName(header: Uint8Array): string {
  const name = readString(header, 0, 100)
  const prefix = readString(header, 345, 500)
  return prefix ? `${prefix}/${name}` : name
}

function readSize(header: Uint8Array): number {
  if (header[124]! & 0x80) {
    let size = 0
    for (let i = 125; i < 136; i++)
      size = size * 256 + header[i]!
    return size
  }
  let size = 0
  for (let i = 124; i < 136; i++) {
    const byte = header[i]!
    if (byte >= 0x30 && byte <= 0x37)
      size = size * 8 + byte - 0x30
    else if (byte !== 0x20 || size)
      break
  }
  return size
}

/** Records of a pax header: `<length> <key>=<value>\n`. */
function parsePax(data: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    const length = space < 0 ? 0 : Number(readString(data, offset, space))
    if (!length || offset + length > data.length)
      break
    const record = decoder.decode(data.subarray(space + 1, offset + length - 1))
    const equals = record.indexOf('=')
    if (equals > 0)
      fields[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return fields
}
