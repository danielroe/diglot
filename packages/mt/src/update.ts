import type { TranslationRecord } from '@diglot/core'
import type { MtOptions, QaIssue, SourceLike, UpdateSources, UpdateTranslationResult } from './types.ts'
import { matchGlossary, sentenceDiff, splitSentences, validate } from '@diglot/core'
import { z } from 'zod'
import { emptyUsage, generate, resolveModel } from './model.ts'
import { alignPlaceholders, renumber } from './placeholders.ts'
import { PROMPT_VERSION, updateSystemPrompt, updateUserPrompt } from './prompts.ts'
import { hasErrors, runQa } from './qa.ts'
import { applyTypography } from './typography.ts'

const schema = z.object({ text: z.string() })

/** Word-level diff in `[-removed-] {+added+}` notation. */
export function wordDiff(before: string, after: string): string {
  const x = before.split(/\s+/).filter(Boolean)
  const y = after.split(/\s+/).filter(Boolean)
  const lcs = Array.from({ length: x.length + 1 }, () => Array.from<number>({ length: y.length + 1 }).fill(0))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  }
  const out: string[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    if (removed.length)
      out.push(`[-${removed.join(' ')}-]`)
    if (added.length)
      out.push(`{+${added.join(' ')}+}`)
    removed = []
    added = []
  }
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush()
      out.push(x[i++]!)
      j++
    }
    else if (j < y.length && (i >= x.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      added.push(y[j++]!)
    }
    else {
      removed.push(x[i++]!)
    }
  }
  flush()
  return out.join(' ')
}

/**
 * Updates a translation after its source changed. When the skeletons are identical (the hash
 * changed through its context salt) the previous text is carried over without a model call;
 * otherwise the model receives the word diff, the new source and the previous translation
 * and changes only what the diff affects.
 */
export async function updateTranslation(previous: Pick<TranslationRecord, 'text'>, sources: UpdateSources, options: MtOptions): Promise<UpdateTranslationResult> {
  const usage = emptyUsage()
  const prior: SourceLike = typeof sources.previousSource === 'string' ? { skeleton: sources.previousSource } : sources.previousSource
  const next = sources.nextSource
  const map = alignPlaceholders(prior, next)
  const previousSource = renumber(prior.skeleton, map)
  const previousText = renumber(previous.text, map)
  const changed = (text: string) => {
    const diff = sentenceDiff(previousText, text, options.locale)
    return diff.changed.map(i => diff.after[i]!)
  }

  if (prior.skeleton === next.skeleton) {
    const result = validate(previousText, next)
    if (result.ok)
      return { status: 'ok', text: previousText, derived: 'carry', changedSentences: [], issues: runQa(previousText, next, options).filter(i => i.severity === 'warning'), usage }
  }

  const model = resolveModel(options.model)
  const system = updateSystemPrompt(options, matchGlossary(options.glossary ?? { terms: [] }, next.skeleton))
  const diff = wordDiff(previousSource, next.skeleton)
  let output: string | undefined
  let issues: QaIssue[] = []
  for (let attempt = 0; attempt <= (options.qaRetries ?? 1); attempt++) {
    const prompt = updateUserPrompt({
      wordDiff: diff,
      nextSource: next.skeleton,
      previousTranslation: previousText,
      ...(attempt && output !== undefined ? { previousOutput: output, issues } : {}),
    })
    const response = await generate({ model, system, prompt, schema, usage, ...(options.pricing ? { pricing: options.pricing } : {}), ...(options.signal ? { signal: options.signal } : {}) })
    if (!response) {
      issues = [{ check: 'response', severity: 'error', message: 'response did not match the schema' }]
      continue
    }
    output = typeset(response.text.trim(), previousText, options)
    issues = runQa(output, next, options)
    if (!hasErrors(issues))
      return { status: 'ok', text: output, derived: 'update', changedSentences: changed(output), issues, mt: { model: model.modelId, promptVersion: PROMPT_VERSION, candidate: output }, usage }
  }
  return { status: 'rejected', ...(output === undefined ? {} : { output }), issues, usage }
}

function typeset(text: string, previous: string, options: MtOptions): string {
  const typography = options.style?.typography
  if (!typography)
    return text
  const kept = new Set(splitSentences(previous, options.locale))
  let out = text
  for (const sentence of splitSentences(text, options.locale)) {
    if (!kept.has(sentence))
      out = out.replace(sentence, () => applyTypography(sentence, typography))
  }
  return out
}
