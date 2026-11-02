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
  name?: string
  depth?: number
  lang?: string | null
  meta?: string | null
  alt?: string | null
  attributes?: Record<string, unknown>
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

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdc).use(remarkFrontmatter)

/** Parses markdown with remark-parse, remark-gfm, remark-mdc and remark-frontmatter. */
export async function parse(source: string): Promise<MdNode> {
  return await processor.run(processor.parse(source)) as MdNode
}
