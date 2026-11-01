import type { TranslationRecord } from '@diglot/core'
import type { ReviewComment, ReviewData } from '@x18n/core'
import { readRecord, writeRecord } from '@diglot/store'

/**
 * Applies an x18n review thread to a record. The last open approval of the record's
 * current text verifies it; a change request or a suggestion leaves the record as it is.
 */
export function reviewRecord(record: TranslationRecord, comments: readonly ReviewComment[]): TranslationRecord {
  const decisive = comments.findLast(c => !c.resolved && (c.type === 'approve' || c.type === 'request-change'))
  if (decisive?.type !== 'approve' || (decisive.value !== undefined && decisive.value !== record.text))
    return record
  const by = decisive.author?.name ?? decisive.author?.email
  if (!by || (record.review === 'verified' && record.verifiedBy?.by === by))
    return record
  return { ...record, review: 'verified', verifiedBy: { by, at: decisive.time }, updatedAt: decisive.time }
}

/** Verifies the records of `root` that an x18n review file approves. Returns the paths it wrote. */
export async function applyReviews(root: string, data: ReviewData): Promise<string[]> {
  const written: string[] = []
  for (const [hash, byLocale] of Object.entries(data.threads)) {
    for (const [locale, comments] of Object.entries(byLocale)) {
      const record = await readRecord(root, locale, hash)
      if (!record)
        continue
      const next = reviewRecord(record, comments)
      if (next !== record)
        written.push(await writeRecord(root, locale, next))
    }
  }
  return written
}
