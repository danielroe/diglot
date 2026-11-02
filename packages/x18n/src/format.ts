import type { SegmentStatus } from '@diglot/core'
import type { ManifestEntry } from '@diglot/store'
import type { Format, MessageState, MessageTree, NodeRange, TextEdit } from '@x18n/core'
import type { DiglotState } from './state.ts'
import { createRecord, isPlaceholderOnly, normaliseRecord, parseRecord, RECORD_KEYS, recordStatus } from '@diglot/core'
import { validationTarget } from '@diglot/store'
import { topLevelRanges } from './json.ts'

/** Id of the format that reads one diglot record file as one message. */
export const RECORD_FORMAT = 'diglot-record'
/** Id of the format that reads a source manifest as the source-locale messages. */
export const MANIFEST_FORMAT = 'diglot-manifest'

const FILE_LINE = /^\s*("(?:[^"\\]|\\.)*"): \[/

interface LocatedEntry extends ManifestEntry {
  offset: number
  label: string
}

export function manifestEntries(text: string): Map<string, LocatedEntry[]> {
  const out = new Map<string, LocatedEntry[]>()
  let offset = 0
  let file = ''
  let heading: string | undefined
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/,$/, '')
    if (trimmed.startsWith('{"hash":')) {
      const entry = JSON.parse(trimmed) as ManifestEntry
      const placeholderOnly = isPlaceholderOnly(entry.skeleton)
      if (entry.kind === 'heading')
        heading = placeholderOnly ? undefined : entry.skeleton
      if (!placeholderOnly)
        out.set(entry.hash, [...out.get(entry.hash) ?? [], { ...entry, offset: offset + line.indexOf('{'), label: heading ? `${file} > ${heading}` : file }])
    }
    else {
      const match = FILE_LINE.exec(line)
      if (match) {
        file = JSON.parse(match[1]!) as string
        heading = undefined
      }
    }
    offset += line.length + 1
  }
  return out
}

export function manifestFormat(): Format {
  return {
    id: MANIFEST_FORMAT,
    extensions: [],
    parse(text) {
      const tree: Record<string, string> = {}
      const ranges = new Map<string, NodeRange>()
      const labels = new Map<string, string>()
      for (const [hash, [entry]] of manifestEntries(text)) {
        tree[hash] = entry!.skeleton
        labels.set(hash, entry!.label)
        const end = text.indexOf('\n', entry!.offset)
        const props = topLevelRanges(text, entry!.offset, end < 0 ? text.length : end)
        const key = props.get('hash')
        const value = props.get('skeleton')
        if (key && value)
          ranges.set(hash, { key: key.value, value: value.value })
      }
      return { tree, ranges, labels }
    },
  }
}

type RawRecord = Record<string, unknown>

const STATES: Record<SegmentStatus, MessageState | undefined> = {
  'untranslated': undefined,
  'machine': 'needs-review',
  'pending-review': 'needs-review',
  'rejected': 'needs-review',
  'edited': 'translated',
  'verified': 'reviewed',
}

function splitRaw(raw: RawRecord): { known: RawRecord, extra: RawRecord } {
  const known: RawRecord = {}
  const extra: RawRecord = {}
  for (const [key, value] of Object.entries(raw))
    ((RECORD_KEYS as readonly string[]).includes(key) ? known : extra)[key] = value
  return { known, extra }
}

export function serialiseRaw(raw: RawRecord): string {
  const { known, extra } = splitRaw(raw)
  const record = parseRecord(normaliseRecord(known as never))
  return `${JSON.stringify({ ...record, ...extra }, null, 2)}\n`
}

function messageState(raw: RawRecord, segment: ManifestEntry | undefined): MessageState | undefined {
  try {
    return STATES[recordStatus(parseRecord(splitRaw(raw).known), segment && validationTarget(segment))]
  }
  catch {
    return undefined
  }
}

function readRaw(text: string): RawRecord {
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as RawRecord).hash !== 'string')
    throw new Error('not a diglot record')
  return raw as RawRecord
}

export function editRecord(raw: RawRecord, text: string, now: Date = new Date()): RawRecord {
  if (raw.text === text)
    return raw
  const { verifiedBy: _, rejectedBy: __, ...rest } = raw
  return { ...rest, text, review: 'edited', updatedAt: now.toISOString() }
}

export function recordFormat(state: DiglotState): Format {
  return {
    id: RECORD_FORMAT,
    extensions: [],
    parse(text) {
      const raw = readRaw(text)
      const hash = raw.hash as string
      const props = topLevelRanges(text)
      const key = props.get('hash')
      const value = props.get('text')
      const translation = messageState(raw, state.segments.get(hash))
      return {
        tree: { [hash]: typeof raw.text === 'string' ? raw.text : '' },
        ranges: key && value ? new Map([[hash, { key: key.value, value: value.value }]]) : undefined,
        states: translation ? new Map([[hash, translation]]) : undefined,
      }
    },
    edit(text, ops) {
      let raw = readRaw(text)
      for (const op of ops) {
        if (op.path.length !== 1 || op.path[0] !== raw.hash)
          throw new Error(`a diglot record only holds ${raw.hash as string}`)
        if (op.type === 'delete')
          throw new Error('diglot records are removed with diglot, not x18n')
        raw = editRecord(raw, String(op.value ?? ''))
      }
      const out = serialiseRaw(raw)
      return out === text ? [] : [{ range: { start: 0, end: text.length }, text: out } satisfies TextEdit]
    },
    serialize(tree: MessageTree) {
      const entries = Object.entries(tree)
      const [hash, text] = entries[0] ?? []
      const segment = hash && state.segments.get(hash)
      if (entries.length !== 1 || typeof text !== 'string' || !segment)
        throw new Error('a diglot record holds exactly one live hash')
      return serialiseRaw(createRecord({ segment, text, origin: 'human', review: 'edited' }) as unknown as RawRecord)
    },
  }
}
