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
    if (path.endsWith('.yml') || path.endsWith('.yaml'))
      files[path] = extractNavigation(content, { file: path, policy: config.policy })
    // comark doesn't read MDX, so `.mdx` files always go through the mdast adapter.
    else if (config.parser !== 'comark' || path.endsWith('.mdx'))
      files[path] = await extractMdast(content, { file: path, parser: config.parser === 'satteri' ? 'satteri' : 'remark', policy: config.policy })
    else
      files[path] = (await extractComark(await parse(content), { file: path, policy: config.policy, ...options })).segments
  }
  return { snapshot, files }
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
