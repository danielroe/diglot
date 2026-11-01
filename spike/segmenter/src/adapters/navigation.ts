import { parse } from 'yaml'
import { buildSegments } from '../core/segment.ts'
import type { InlineNode, Segment, SegmentDraft } from '../core/types.ts'

export const NAVIGATION_PROSE = ['title', 'titleTemplate', 'description']

/** Segments a `.navigation.yml` file. `%s` in templates becomes a placeholder. */
export function extractNavigation(file: string, source: string): { segments: Segment[], keys: string[] } {
  const data = (parse(source) ?? {}) as Record<string, unknown>
  const drafts: SegmentDraft[] = []
  for (const key of NAVIGATION_PROSE) {
    const value = data[key]
    if (typeof value !== 'string' || !value.trim()) continue
    drafts.push({
      kind: 'navigation',
      content: value.includes('%s') ? templateInline(value) : value,
      context: { headingTrail: [], containers: [], detail: key },
      position: { startLine: 1, endLine: 1, precision: 'file' },
    })
  }
  return { segments: buildSegments(file, drafts), keys: Object.keys(data) }
}

function templateInline(value: string): InlineNode[] {
  return value.split(/(%s)/).filter(Boolean).map(part => part === '%s'
    ? { type: 'atomic', kind: 'other', source: '%s' }
    : { type: 'text', value: part })
}
