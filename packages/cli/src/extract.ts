import type { Segment, SourceConfig } from '@diglot/core'
import type { ResolvedConfig, SourceSnapshot } from '@diglot/store'
import { extract as extractComark, extractNavigation, parse } from '@diglot/comark'
import { extract as extractMdast } from '@diglot/mdast'
import { readSource } from '@diglot/store'

export interface ExtractedSource {
  snapshot: SourceSnapshot
  files: Record<string, Segment[]>
}

export interface ExtractSourceOptions {
  /** Resolve the markdown of protected spans in comark documents. Defaults to `true`; manifests do not need it. */
  spanSources?: boolean
}

/** Reads a source and extracts the segments of every document in it. */
export async function extractSource(config: ResolvedConfig, source: SourceConfig, options: ExtractSourceOptions = {}): Promise<ExtractedSource> {
  const snapshot = await readSource(source, config.root)
  const files: Record<string, Segment[]> = {}
  for (const { path, content } of snapshot.files) {
    try {
      files[path] = await extractFile(config, path, content, options)
    }
    catch (error) {
      const { message, line, column } = error as { message: string, line?: number, column?: number }
      const at = typeof line === 'number' && !message.startsWith(`${line}:`) ? `${line}:${column}: ` : ''
      throw new Error(`${path}: ${at}${message}`, { cause: error })
    }
  }
  return { snapshot, files }
}

async function extractFile(config: ResolvedConfig, path: string, content: string, options: ExtractSourceOptions): Promise<Segment[]> {
  if (path.endsWith('.yml') || path.endsWith('.yaml'))
    return extractNavigation(content, { file: path, policy: config.policy })
  if (config.parser !== 'comark' || path.endsWith('.mdx'))
    return extractMdast(content, { file: path, parser: config.parser === 'satteri' ? 'satteri' : 'remark', policy: config.policy })
  return (await extractComark(await parse(content), { file: path, policy: config.policy, ...options })).segments
}

/** Sources selected by `--source`, all of them by default. */
export function selectSources(config: ResolvedConfig, name?: string): SourceConfig[] {
  if (!name)
    return config.sources
  const found = config.sources.filter(s => s.name === name)
  if (!found.length)
    throw new Error(`unknown source "${name}"; configured: ${config.sources.map(s => s.name).join(', ') || 'none'}`)
  return found
}
