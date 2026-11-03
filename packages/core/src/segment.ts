import type { Policy } from './policy.ts'
import type { InlineNode, Segment, SegmentDraft, SegmentFormat } from './types.ts'
import { sha256 } from './sha256.ts'
import { countWords, fromSkeleton, normalise, toSkeleton } from './skeleton.ts'

/** Truncated sha256 used for segment identity. Plain and markdown segments with the same skeleton hash apart. */
export function hashSkeleton(skeleton: string, salt?: string, format: SegmentFormat = 'markdown'): string {
  const salted = salt ? `${salt}\0${skeleton}` : skeleton
  const input = format === 'plain' ? `plain\0${salted}` : salted
  return sha256(input).slice(0, 16)
}

export interface BuildOptions {
  file: string
  index: number
  policy?: Pick<Policy, 'salt'>
}

/** Turns an adapter draft into a segment. Returns `undefined` for units without content. */
export function buildSegment(draft: SegmentDraft, options: BuildOptions): Segment | undefined {
  const format = draft.format ?? (typeof draft.content === 'string' ? 'plain' : 'markdown')
  const content: InlineNode[] = typeof draft.content === 'string' ? [{ type: 'text', value: draft.content }] : draft.content
  const { skeleton, placeholders } = toSkeleton(normalise(content), format)
  if (!skeleton)
    return
  const salt = options.policy?.salt?.({ kind: draft.kind, skeleton, file: options.file, ...draft.context })
  const text = fromSkeleton(skeleton, placeholders)
  return {
    hash: hashSkeleton(skeleton, salt, format),
    sourceHash: hashSkeleton(text, salt, format),
    kind: draft.kind,
    format,
    skeleton,
    text,
    placeholders,
    words: countWords(skeleton),
    context: { file: options.file, index: options.index, ...draft.context },
    position: draft.position,
    ...(salt ? { salt } : {}),
  }
}

/** Builds the segments of one file, numbering them in order. */
export function buildSegments(file: string, drafts: SegmentDraft[], policy?: Pick<Policy, 'salt'>): Segment[] {
  const segments: Segment[] = []
  for (const draft of drafts) {
    const segment = buildSegment(draft, { file, index: segments.length, policy })
    if (segment)
      segments.push(segment)
  }
  return segments
}
