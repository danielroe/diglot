import { createHash } from 'node:crypto'
import { countWords, fromPlaceholderForm, normalise, toPlaceholderForm } from './skeleton.ts'
import type { Segment, SegmentDraft } from './types.ts'

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export function buildSegments(file: string, drafts: SegmentDraft[]): Segment[] {
  const out: Segment[] = []
  for (const draft of drafts) {
    const seg = buildSegment(file, out.length, draft)
    if (seg) out.push(seg)
  }
  return out
}

export function buildSegment(file: string, index: number, draft: SegmentDraft): Segment | undefined {
  const plain = typeof draft.content === 'string'
  const { skeleton, placeholders } = plain
    ? { skeleton: (draft.content as string).replace(/\s+/g, ' ').trim(), placeholders: [] }
    : toPlaceholderForm(normalise(draft.content as Exclude<SegmentDraft['content'], string>))
  if (!skeleton) return
  const text = fromPlaceholderForm(skeleton, placeholders)
  return {
    hash: hashText(skeleton),
    sourceHash: hashText(text),
    kind: draft.kind,
    format: plain ? 'plain' : 'markdown',
    skeleton,
    text,
    placeholders,
    words: countWords(skeleton),
    context: { file, index, ...draft.context },
    position: draft.position,
  }
}
