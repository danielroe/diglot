import { createHash } from 'node:crypto'
import { generateText, Output } from 'ai'
import { z } from 'zod'
import { mask, unmask, type Token } from './placeholders.ts'
import { type Locale } from './glossary.ts'
import { systemPrompt, userPrompt, type PromptContext } from './prompts.ts'
import { runQa, type QaIssue } from './qa.ts'
import type { Segment } from './extract.ts'

export const MODEL = process.env.MT_MODEL ?? 'anthropic/claude-sonnet-5.5'
export const PRICE = { input: 2 / 1e6, output: 10 / 1e6 }

export type ContextMode = 'none' | 'neighbours'

export interface TranslateOptions {
  locale: Locale
  glossary: boolean
  context: ContextMode
  batchSize: number | 'page'
  final?: boolean
  concurrency?: number
}

export interface RequestLog {
  ids: string[]
  returnedIds: string[]
  idsRoundTrip: boolean
  latencyMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  error?: string
}

export interface SegmentResult {
  id: string
  kind: string
  source: string
  sourceMasked: string
  tokens: Token[]
  targetMasked: string | null
  target: string | null
  qa: QaIssue[]
}

export interface RunResult {
  options: TranslateOptions
  model: string
  segments: SegmentResult[]
  requests: RequestLog[]
}

export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)

const schema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) })

function chunk<T> (items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) { out.push(items.slice(i, i + size)) }
  return out
}

function batches (segments: Segment[], size: number | 'page'): Segment[][] {
  const byPage = new Map<string, Segment[]>()
  for (const s of segments) { byPage.set(s.file, [...(byPage.get(s.file) ?? []), s]) }
  const out: Segment[][] = []
  for (const page of byPage.values()) { out.push(...(size === 'page' ? [page] : chunk(page, size))) }
  return out
}

async function pool<T, R> (items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }))
  return results
}

export async function callModel<T> (system: string, prompt: string, outSchema: z.ZodType<T>) {
  const t0 = Date.now()
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await generateText({ model: MODEL, system, prompt, output: Output.object({ schema: outSchema }), maxRetries: 2 })
      const inputTokens = r.usage.inputTokens ?? 0
      const outputTokens = r.usage.outputTokens ?? 0
      return { output: r.output as T, latencyMs: Date.now() - t0, inputTokens, outputTokens, costUsd: inputTokens * PRICE.input + outputTokens * PRICE.output }
    }
    catch (e) { lastError = e }
  }
  throw lastError
}

export async function runTranslation (all: Segment[], options: TranslateOptions): Promise<RunResult> {
  const masked = new Map(all.map(s => [s.id, mask(s.text, { dedupe: options.final })]))
  const index = new Map(all.map((s, i) => [s.id, i]))
  const system = systemPrompt({ locale: options.locale, glossary: options.glossary, final: options.final })
  const groups = batches(all, options.batchSize)
  const targets = new Map<string, string>()
  const requests = await pool(groups, options.concurrency ?? 6, async (group): Promise<RequestLog> => {
    const local = group.map((s, i) => ({ id: `s${i + 1}`, kind: s.kind, text: masked.get(s.id)!.masked }))
    let context: PromptContext | undefined
    const first = group[0]!
    if (options.batchSize !== 1) {
      context = { pageTitle: first.pageTitle, headingTrail: first.headingTrail }
    }
    else if (options.context === 'neighbours') {
      const i = index.get(first.id)!
      const prev = all[i - 1]?.file === first.file ? all[i - 1] : undefined
      const next = all[i + 1]?.file === first.file ? all[i + 1] : undefined
      context = {
        pageTitle: first.pageTitle,
        headingTrail: first.headingTrail,
        previous: prev ? masked.get(prev.id)!.masked : undefined,
        next: next ? masked.get(next.id)!.masked : undefined,
      }
    }
    const ids = local.map(l => l.id)
    try {
      const r = await callModel(system, userPrompt(local, context), schema)
      const returnedIds = r.output.translations.map(t => t.id)
      for (const t of r.output.translations) {
        const k = ids.indexOf(t.id)
        if (k >= 0 && !targets.has(group[k]!.id)) { targets.set(group[k]!.id, t.text) }
      }
      const idsRoundTrip = returnedIds.length === ids.length && returnedIds.every((id, i) => id === ids[i])
      return { ids: group.map(s => s.id), returnedIds, idsRoundTrip, latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd }
    }
    catch (e) {
      return { ids: group.map(s => s.id), returnedIds: [], idsRoundTrip: false, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, error: String(e).slice(0, 500) }
    }
  })
  const segments = all.map((s): SegmentResult => {
    const m = masked.get(s.id)!
    const targetMasked = targets.get(s.id) ?? null
    const target = targetMasked === null ? null : unmask(targetMasked, m.tokens)
    const qa = targetMasked === null ? [] : runQa({ locale: options.locale, sourceMasked: m.masked, targetMasked, tokens: m.tokens, source: s.text, target: target! })
    return { id: s.id, kind: s.kind, source: s.text, sourceMasked: m.masked, tokens: m.tokens, targetMasked, target, qa }
  })
  return { options, model: MODEL, segments, requests }
}
