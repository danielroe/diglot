const encoder = new TextEncoder()

function header(name: string, size: number, type: string, prefix = ''): Uint8Array {
  const block = new Uint8Array(512)
  const put = (value: string, offset: number) => block.set(encoder.encode(value), offset)
  put(name, 0)
  put('0000644\0', 100)
  put('0000000\0', 108)
  put('0000000\0', 116)
  put(`${size.toString(8).padStart(11, '0')}\0`, 124)
  put('00000000000\0', 136)
  put('        ', 148)
  put(type, 156)
  put('ustar\0', 257)
  put('00', 263)
  put(prefix, 345)
  const sum = block.reduce((total, byte) => total + byte, 0)
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return block
}

function pax(fields: Record<string, string>): Uint8Array {
  let out = ''
  for (const [key, value] of Object.entries(fields)) {
    const body = ` ${key}=${value}\n`
    let length = body.length + 1
    while (`${length}${body}`.length !== length)
      length++
    out += `${length}${body}`
  }
  return encoder.encode(out)
}

/** A `tar` archive of `files`, in the shape of a GitHub tarball: a pax global header, then everything under `<root>/`. */
export function tar(root: string, files: Record<string, string>, options: { sha?: string, longNames?: 'pax' | 'gnu' } = {}): Uint8Array {
  const blocks: Uint8Array[] = []
  const add = (head: Uint8Array, body?: Uint8Array) => {
    blocks.push(head)
    if (body) {
      const padded = new Uint8Array(Math.ceil(body.length / 512) * 512)
      padded.set(body)
      blocks.push(padded)
    }
  }
  if (options.sha) {
    const body = pax({ comment: options.sha })
    add(header('pax_global_header', body.length, 'g'), body)
  }
  add(header(`${root}/`, 0, '5'))
  for (const [path, content] of Object.entries(files)) {
    const body = encoder.encode(content)
    const name = `${root}/${path}`
    if (name.length > 100 && name.lastIndexOf('/', 155) > 0) {
      const split = name.lastIndexOf('/', 155)
      if (name.length - split - 1 <= 100) {
        add(header(name.slice(split + 1), body.length, '0', name.slice(0, split)), body)
        continue
      }
    }
    if (name.length > 100) {
      const long = options.longNames === 'gnu' ? encoder.encode(`${name}\0`) : pax({ path: name })
      add(header(options.longNames === 'gnu' ? '././@LongLink' : 'PaxHeader', long.length, options.longNames === 'gnu' ? 'L' : 'x'), long)
      add(header(name.slice(0, 100), body.length, '0'), body)
      continue
    }
    add(header(name, body.length, '0'), body)
  }
  blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  return out
}

/** A stream of `bytes` in chunks of `size`. */
export function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length)
        return controller.close()
      controller.enqueue(bytes.slice(offset, offset += size))
    },
  })
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
