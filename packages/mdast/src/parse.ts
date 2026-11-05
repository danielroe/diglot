import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkMdc from 'remark-mdc'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** The subset of mdast (with remark-mdc and MDX extensions) the adapter reads. */
export interface MdNode {
  type: string
  children?: MdNode[]
  value?: string
  name?: string | null
  depth?: number
  lang?: string | null
  meta?: string | null
  alt?: string | null
  /** Attributes of an MDC component, or the attributes of an MDX JSX element. */
  attributes?: Record<string, unknown> | MdxJsxAttribute[] | null
  fmAttributes?: Record<string, unknown>
  spread?: boolean | null
  data?: { hName?: string, hProperties?: Record<string, unknown> }
  position?: { start: Point, end: Point }
}

/** An attribute of an MDX JSX element. Expression values and spread attributes are not plain strings. */
export interface MdxJsxAttribute {
  type: string
  name?: string
  value?: unknown
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

/**
 * `md` is markdown, `mdx` is MDX: markdown with JSX, expressions and ESM. MDX is never read as MDC;
 * both parsers read its `:::` directives instead, as Starlight asides use them.
 */
export type Format = 'md' | 'mdx'

export interface ParseOptions {
  /** Defaults to `remark`. */
  parser?: Parser
  /** Defaults to `md`. */
  format?: Format
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdc).use(remarkFrontmatter)
// The MDX extensions (with acorn) only load once a document needs them.
let mdxProcessor: ReturnType<typeof createMdxProcessor> | undefined

/** Parses markdown or MDX into an mdast tree with source positions. */
export async function parse(source: string, options: ParseOptions = {}): Promise<MdNode> {
  const mdx = options.format === 'mdx'
  if (options.parser === 'satteri') {
    const { markdownToMdast, mdxToMdast } = await importSatteri()
    return (mdx ? mdxToMdast : markdownToMdast)(source, { features: { gfm: true, frontmatter: true, directive: true } }) as MdNode
  }
  const remark = mdx ? await (mdxProcessor ??= createMdxProcessor()) : processor
  return await remark.run(remark.parse(source)) as MdNode
}

/** The format of a file: `mdx` for `.mdx` files, `md` otherwise. */
export function formatOf(file: string | undefined): Format {
  return file?.endsWith('.mdx') ? 'mdx' : 'md'
}

async function createMdxProcessor() {
  const [{ default: remarkDirective }, { default: remarkMdx }] = await Promise.all([import('remark-directive'), import('remark-mdx')])
  return unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkDirective).use(remarkFrontmatter)
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
