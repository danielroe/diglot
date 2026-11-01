import { z } from 'zod'
import { mask, maskWith, unmask, type Token } from './placeholders.ts'
import { wordDiff } from './diff.ts'
import { updateSystemPrompt, updateUserPrompt } from './prompts.ts'
import { callModel } from './translate.ts'
import type { Locale } from './glossary.ts'

export interface PreviousTranslation {
  source: string
  text: string
  locale: Locale
}

export interface UpdateResult {
  method: 'carry' | 'model'
  text: string
  masked: string
  sourceMasked: string
  tokens: Token[]
  wordDiff?: string
  previousMasked?: string
  costUsd: number
  latencyMs: number
}

export function unionTokens (next: Token[], previous: Token[]): Token[] {
  const union = [...next]
  for (const t of previous) {
    if (!union.some(u => u.kind === t.kind && u.value === t.value)) { union.push({ ...t, id: union.length }) }
  }
  return union
}

export async function updateTranslation (previous: PreviousTranslation, nextSource: string, options: { glossary?: boolean, dedupe?: boolean } = {}): Promise<UpdateResult> {
  const next = mask(nextSource, { dedupe: options.dedupe })
  const old = mask(previous.source, { dedupe: options.dedupe })
  if (old.masked === next.masked) {
    const carried = maskWith(previous.text, old.tokens)
    return { method: 'carry', text: unmask(carried, next.tokens), masked: carried, sourceMasked: next.masked, tokens: next.tokens, costUsd: 0, latencyMs: 0 }
  }
  const tokens = unionTokens(next.tokens, old.tokens)
  const previousSource = maskWith(previous.source, tokens)
  const previousMasked = maskWith(previous.text, tokens)
  const diff = wordDiff(previousSource, next.masked)
  const r = await callModel(
    updateSystemPrompt(previous.locale, options.glossary),
    updateUserPrompt({ previousSource, nextSource: next.masked, wordDiff: diff, previousTranslation: previousMasked }),
    z.object({ text: z.string() }),
  )
  return { method: 'model', text: unmask(r.output.text, tokens), masked: r.output.text, sourceMasked: next.masked, tokens, wordDiff: diff, previousMasked, costUsd: r.costUsd, latencyMs: r.latencyMs }
}
