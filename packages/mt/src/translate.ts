import type { GlossaryEntry } from '@diglot/core'
import type { DedupedSkeleton } from './placeholders.ts'
import type { PromptSegment } from './prompts.ts'
import type { MtSegment, PageContext, QaIssue, RejectedSegment, SegmentTranslation, TranslateSegmentsOptions, TranslateSegmentsResult } from './types.ts'
import { encodeInvisibles, isPlaceholderOnly, matchGlossary } from '@diglot/core'
import { z } from 'zod'
import { emptyUsage, generate, resolveModel } from './model.ts'
import { dedupePlaceholders } from './placeholders.ts'
import { PROMPT_VERSION, retryUserPrompt, translateSystemPrompt, translateUserPrompt } from './prompts.ts'
import { hasErrors, runQa } from './qa.ts'
import { applyTypography } from './typography.ts'

const schema = z.object({ translations: z.array(z.object({ id: z.string(), text: z.string() })) })

interface Item {
  id: string
  segment: MtSegment
  deduped: DedupedSkeleton
  raw?: string
  text?: string
  issues: QaIssue[]
}

/**
 * Translates segments with page-batched structured output. Identical segments are translated
 * once, segments without letters are skipped, and every output passes `validate` and the QA
 * checks; segments that fail an error-level check are retried with the problems listed, then
 * rejected.
 */
export async function translateSegments(segments: MtSegment[], options: TranslateSegmentsOptions): Promise<TranslateSegmentsResult> {
  const model = resolveModel(options.model)
  const usage = emptyUsage()
  const seen = new Set<string>()
  const ordered = segments.filter(s => !isPlaceholderOnly(s.skeleton) && !seen.has(s.hash) && seen.add(s.hash))
  const translations: SegmentTranslation[] = []
  const rejected: RejectedSegment[] = []
  const mt = { model: model.modelId, promptVersion: PROMPT_VERSION }

  await pool(batches(ordered, options.batch ?? 'page', options.maxBatch ?? 40), options.concurrency ?? 4, async (group) => {
    const context = typeof options.context === 'function' ? options.context(group[0]!.context?.file) : options.context
    const system = translateSystemPrompt(options, relevantTerms(options.glossary?.terms, group, context))
    const items: Item[] = group.map((segment, i) => ({ id: `s${i + 1}`, segment, deduped: dedupePlaceholders(segment.skeleton, segment.placeholders), issues: [] }))
    let pending = items
    for (let attempt = 0; pending.length && attempt <= (options.qaRetries ?? 1); attempt++) {
      const prompt = attempt === 0
        ? translateUserPrompt(pending.map(promptSegment), context)
        : retryUserPrompt(pending.map(item => ({ ...promptSegment(item), ...(item.raw === undefined ? {} : { previous: item.raw }), issues: item.issues })), context)
      const output = await generate({ model, system, prompt, schema, usage, ...(options.pricing ? { pricing: options.pricing } : {}), ...(options.signal ? { signal: options.signal } : {}) })
      const returned = new Map<string, string>()
      for (const t of output?.translations ?? []) {
        if (!returned.has(t.id))
          returned.set(t.id, t.text)
      }
      for (const item of pending) {
        const raw = returned.get(item.id)
        if (raw === undefined) {
          item.issues = [{ check: 'response', severity: 'error', message: output ? 'missing from the response' : 'response did not match the schema' }]
          continue
        }
        item.raw = raw
        const text = applyTypography(item.deduped.expand(raw.trim()), options.style?.typography)
        item.text = item.segment.format === 'plain' ? text : encodeInvisibles(text)
        item.issues = runQa(item.text, item.segment, options)
      }
      pending = pending.filter(item => hasErrors(item.issues))
    }
    for (const item of items) {
      if (hasErrors(item.issues))
        rejected.push({ hash: item.segment.hash, ...(item.text === undefined ? {} : { output: item.text }), issues: item.issues })
      else
        translations.push({ hash: item.segment.hash, text: item.text!, derived: 'fresh', issues: item.issues, mt: { ...mt, candidate: item.text! } })
    }
  })

  const order = new Map(ordered.map((s, i) => [s.hash, i]))
  const byOrder = (a: { hash: string }, b: { hash: string }) => order.get(a.hash)! - order.get(b.hash)!
  return { translations: translations.sort(byOrder), rejected: rejected.sort(byOrder), usage }
}

function promptSegment(item: Item): PromptSegment {
  return { id: item.id, kind: item.segment.kind, ...(item.segment.format === 'plain' ? { format: 'plain' as const } : {}), text: item.deduped.skeleton }
}

function relevantTerms(terms: GlossaryEntry[] | undefined, group: MtSegment[], context?: PageContext): GlossaryEntry[] {
  if (!terms?.length)
    return []
  const text = [context?.title ?? '', ...group.map(s => s.skeleton)].join('\n')
  return matchGlossary({ terms }, text)
}

function batches(segments: MtSegment[], batch: 'page' | number, maxBatch: number): MtSegment[][] {
  const byFile = Map.groupBy(segments, s => s.context?.file ?? '')
  const size = batch === 'page' ? maxBatch : Math.max(1, batch)
  return [...byFile.values()].flatMap((page) => {
    const count = Math.ceil(page.length / size)
    const even = Math.ceil(page.length / count)
    return Array.from({ length: count }, (_, i) => page.slice(i * even, (i + 1) * even))
  })
}

async function pool<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length)
      await run(items[next++]!)
  }))
}
