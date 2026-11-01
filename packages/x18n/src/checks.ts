import type { Check } from '@x18n/core'
import type { RecordIndex } from './records.ts'
import { recordStatus, validate } from '@diglot/core'
import { validationTarget } from '@diglot/store'

export function validateCheck(index: RecordIndex): Check {
  return {
    id: 'diglot-validate',
    defaultSeverity: 'error',
    description: 'A translation that would not apply safely: missing placeholders, raw markdown, or markup a plain segment cannot hold.',
    * run(ctx) {
      const entries = index.entries(ctx.resources, ctx.text)
      for (const message of ctx.messages()) {
        if (message.locale === ctx.sourceLocale || typeof message.value !== 'string' || message.value === '')
          continue
        for (const entry of entries.get(message.key) ?? []) {
          const result = validate(message.value, validationTarget(entry))
          for (const issue of result.errors)
            yield { key: message.key, locale: message.locale, message: `${entry.kind}: ${issue.message}.` }
          for (const issue of result.warnings)
            yield { key: message.key, locale: message.locale, severity: 'warning', message: `${entry.kind}: ${issue.message}.` }
        }
      }
    },
  }
}

export function unusedCheck(index: RecordIndex): Check {
  return {
    id: 'diglot-unused',
    defaultSeverity: 'info',
    description: 'A record whose hash no source manifest uses, such as the predecessor of a changed segment.',
    * run(ctx) {
      const entries = index.entries(ctx.resources, ctx.text)
      for (const [locale, records] of index.records(ctx.resources, ctx.text)) {
        for (const record of records.values()) {
          if (!entries.has(record.hash))
            yield { key: record.hash, locale, message: 'Not used by any source.' }
        }
      }
    },
  }
}

export function reviewCheck(index: RecordIndex): Check {
  return {
    id: 'diglot-review',
    defaultSeverity: 'info',
    description: 'A machine translation that no human has reviewed: a hint, or a warning when it updates an earlier translation.',
    * run(ctx) {
      for (const [locale, records] of index.records(ctx.resources, ctx.text)) {
        for (const record of records.values()) {
          const status = recordStatus(record)
          if (status === 'pending-review')
            yield { key: record.hash, locale, severity: 'warning', message: `Machine update of ${record.prev ?? 'an earlier translation'}, pending review.` }
          else if (status === 'machine')
            yield { key: record.hash, locale, severity: 'hint', message: `Machine translation (${record.mt?.model ?? record.origin}), not reviewed.` }
        }
      }
    },
  }
}
