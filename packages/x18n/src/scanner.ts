import type { Segment } from '@diglot/core'
import type { ResolvedConfig } from '@diglot/store'
import type { Scanner, TextRange, UsageCandidate } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { matchesGlob } from 'node:path'
import { extract as extractComark, extractNavigation, parse } from '@diglot/comark'
import { extensions as componentExtensions, extract as extractComponent } from '@diglot/components'
import { isPlaceholderOnly } from '@diglot/core'
import { extract as extractMdast } from '@diglot/mdast'
import { DEFAULT_INCLUDE } from '@diglot/store'
import { join, normalize, relative } from 'pathe'

function sourceFile(config: ResolvedConfig, path: string): string | undefined {
  for (const source of config.sources) {
    const root = relative(config.root, join(config.stateDir, 'sources', source.name))
    const file = relative(normalize(root), path)
    const local = relative(source.dir ?? '.', file)
    if (file.startsWith('..') || local.startsWith('..'))
      continue
    const include = source.include ?? DEFAULT_INCLUDE
    if (include.some(p => matchesGlob(local, p)) && !(source.exclude ?? []).some(p => matchesGlob(local, p)))
      return file
  }
}

export function sourceGlobs(config: ResolvedConfig): string[] {
  return config.sources.flatMap(source => (source.include ?? DEFAULT_INCLUDE).map(p => relative(config.root, join(config.stateDir, 'sources', source.name, source.dir ?? '.', p))))
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n')
      starts.push(i + 1)
  }
  return starts
}

function lineRange(text: string, starts: number[], startLine: number, endLine: number): TextRange {
  const start = starts[Math.max(0, startLine - 1)] ?? 0
  const next = starts[Math.min(starts.length - 1, endLine)]
  const end = endLine >= starts.length ? text.length : (next ?? text.length) - 1
  return { start, end: Math.max(start, end) }
}

function textRange(text: string, segment: Segment, within: TextRange = { start: 0, end: text.length }, taken: TextRange[] = []): TextRange | undefined {
  const needle = segment.text.split(/\s+/).slice(0, 6).join(' ')
  if (!needle)
    return
  for (let at = text.indexOf(needle, within.start); at >= 0 && at + needle.length <= within.end; at = text.indexOf(needle, at + 1)) {
    const end = at + needle.length
    if (!taken.some(range => at < range.end && range.start < end))
      return { start: at, end }
  }
}

export function markdownScanner(state: DiglotState): Scanner {
  return {
    id: 'diglot-markdown',
    extensions: ['md', 'mdx', 'yml'],
    runtime: 'node',
    async scan(file) {
      const config = state.config
      const path = config && sourceFile(config, relative(state.prefix || '.', file.path))
      if (!config || !path)
        return { usages: [] }
      const options = { file: path, policy: config.policy }
      const mdast = { ...options, parser: config.parser === 'satteri' ? 'satteri' as const : 'remark' as const }
      const navigation = file.extension === 'yml'
      const viaMdast = config.parser !== 'comark' || file.extension === 'mdx'
      const segments = navigation
        ? extractNavigation(file.text, options)
        : viaMdast
          ? await extractMdast(file.text, mdast)
          : (await extractComark(await parse(file.text), options)).segments
      const precise = navigation || viaMdast ? segments : await extractMdast(file.text, mdast)
      return { usages: usages(file.text, segments, precise) }
    },
  }
}

/** A `diglot-components` scanner over the Vue, React and Svelte components of each source. */
export function componentScanner(state: DiglotState): Scanner {
  return {
    id: 'diglot-components',
    extensions: componentExtensions,
    runtime: 'node',
    async scan(file) {
      const config = state.config
      const path = config && sourceFile(config, relative(state.prefix || '.', file.path))
      if (!config || !path)
        return { usages: [] }
      const segments = await extractComponent(file.text, { file: path, policy: config.policy })
      return { usages: usages(file.text, segments, segments, true) }
    },
  }
}

/**
 * Usages of the segments that have text, at the lines of their nodes in `precise`. With `exact`, at
 * their text within those lines when it is there, so that two segments on a line get their own.
 */
function usages(text: string, segments: Segment[], precise: Segment[], exact = false): UsageCandidate[] {
  const positions = new Map<string, Segment[]>()
  for (const segment of precise) {
    if (segment.position.precision === 'node')
      positions.set(segment.hash, [...positions.get(segment.hash) ?? [], segment])
  }
  const starts = lineStarts(text)
  const seen = new Map<string, number>()
  const taken = new Set<string>()
  const usages: UsageCandidate[] = []
  for (const segment of segments) {
    if (isPlaceholderOnly(segment.skeleton))
      continue
    const nth = seen.get(segment.hash) ?? 0
    seen.set(segment.hash, nth + 1)
    const position = segment.position.precision === 'node' ? segment.position : positions.get(segment.hash)?.[nth]?.position ?? segment.position
    let range = position.precision === 'file'
      ? textRange(text, segment) ?? { start: 0, end: 0 }
      : lineRange(text, starts, position.startLine, position.endLine)
    if (exact)
      range = textRange(text, segment, range, usages.map(usage => usage.range)) ?? range
    else if (taken.has(`${range.start}:${range.end}`))
      range = textRange(text, segment, range) ?? range
    while (taken.has(`${range.start}:${range.end}`) && range.start < range.end)
      range = { start: range.start + 1, end: range.end }
    taken.add(`${range.start}:${range.end}`)
    usages.push({ raw: segment.hash, range, expression: range, kind: 'marker', dynamic: false })
  }
  return usages
}
