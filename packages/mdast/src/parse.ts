import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdc from 'remark-mdc'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** The subset of mdast (with remark-mdc extensions) the adapter reads. */
export interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  name?: string | null
  depth?: number
  lang?: string | null
  meta?: string | null
  alt?: string | null
  attributes?: Record<string, unknown> | null
  fmAttributes?: Record<string, unknown>
  spread?: boolean | null
  data?: { hName?: string, hProperties?: Record<string, unknown> }
  position?: { start: Point, end: Point }
}

interface Point {
  line: number
  column?: number
  offset?: number
}

/**
 * `remark` parses with remark-parse, remark-gfm, remark-mdc and remark-frontmatter. `satteri`
 * parses GFM, frontmatter and directives natively in Rust and needs the optional `satteri` peer
 * dependency; it has no MDC support.
 */
export type Parser = 'remark' | 'satteri'

export interface ParseOptions {
  /** Defaults to `remark`. */
  parser?: Parser
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdc).use(remarkFrontmatter)

/** Parses markdown into an mdast tree with source positions. */
export async function parse(source: string, options: ParseOptions = {}): Promise<MdNode> {
  if (options.parser === 'satteri') {
    const { markdownToMdast } = await importSatteri()
    return markdownToMdast(source, { features: { gfm: true, frontmatter: true, directive: true } }) as MdNode
  }
  return await processor.run(processor.parse(source)) as MdNode
}

async function importSatteri() {
  try {
    return await import('satteri')
  }
  catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'ERR_MODULE_NOT_FOUND')
      throw error
    throw new Error('The `satteri` parser needs the `satteri` package. Install it with `pnpm add satteri`.', { cause: error })
  }
}
