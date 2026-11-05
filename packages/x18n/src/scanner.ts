import type { Segment } from '@diglot/core'
import type { ResolvedConfig } from '@diglot/store'
import type { Scanner, TextRange, UsageCandidate } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { matchesGlob } from 'node:path'
import { extract as extractComark, extractNavigation, parse } from '@diglot/comark'
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

function textRange(text: string, segment: Segment, within: TextRange = { start: 0, end: text.length }): TextRange | undefined {
  const needle = segment.text.split(/\s+/).slice(0, 6).join(' ')
  const at = needle ? text.slice(within.start, within.end).indexOf(needle) : -1
  return at < 0 ? undefined : { start: within.start + at, end: within.start + at + needle.length }
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
      const positions = new Map<string, Segment[]>()
      for (const segment of precise) {
        if (segment.position.precision === 'node')
          positions.set(segment.hash, [...positions.get(segment.hash) ?? [], segment])
      }
      const starts = lineStarts(file.text)
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
          ? textRange(file.text, segment) ?? { start: 0, end: 0 }
          : lineRange(file.text, starts, position.startLine, position.endLine)
        if (taken.has(`${range.start}:${range.end}`))
          range = textRange(file.text, segment, range) ?? range
        while (taken.has(`${range.start}:${range.end}`) && range.start < range.end)
          range = { start: range.start + 1, end: range.end }
        taken.add(`${range.start}:${range.end}`)
        usages.push({ raw: segment.hash, range, expression: range, kind: 'marker', dynamic: false })
      }
      return { usages }
    },
  }
}
