import type { TranslationRecord } from '@diglot/core'
import type { ReviewComment, ReviewData } from '@x18n/core'
import { verifyRecord } from '@diglot/core'
import { readRecord, writeRecord } from '@diglot/store'

/**
 * Applies an x18n review thread to a record. The last open approval of the record's
 * current text verifies it, by `reviewer` when given; a change request or a suggestion
 * leaves the record as it is, and so does an approval without a value or of a rejected or
 * verified record.
 */
export function reviewRecord(record: TranslationRecord, comments: readonly ReviewComment[], reviewer?: string): TranslationRecord {
  const decisive = comments.findLast(c => !c.resolved && (c.type === 'approve' || c.type === 'request-change'))
  if (decisive?.type !== 'approve' || decisive.value === undefined)
    return record
  const by = reviewer ?? decisive.author?.name ?? decisive.author?.email
  if (!by)
    return record
  const result = verifyRecord(record, { by, at: decisive.time, expected: decisive.value })
  return result.ok ? result.record : record
}

/**
 * Verifies the records of `root` that an x18n review file approves. `reviewer` overrides
 * the identity recorded in `verifiedBy.by`. Returns the paths it wrote.
 */
export async function applyReviews(root: string, data: ReviewData, reviewer?: string): Promise<string[]> {
  const written: string[] = []
  for (const [hash, byLocale] of Object.entries(data.threads)) {
    for (const [locale, comments] of Object.entries(byLocale)) {
      const record = await readRecord(root, locale, hash)
      if (!record)
        continue
      const next = reviewRecord(record, comments, reviewer)
      if (next !== record)
        written.push(await writeRecord(root, locale, next))
    }
  }
  return written
}
