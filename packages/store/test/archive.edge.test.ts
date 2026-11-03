import { describe, expect, it } from 'vitest'
import { archiveLocaleState, parseRecordFile, parseRecordPath, readArchive } from '../src/runtime.ts'
import { withoutBuiltins } from './no-builtins.ts'
import { chunked, gzip, tar } from './tar.ts'

describe('readArchive without Node built-ins', () => {
  withoutBuiltins()

  it('should read a tarball through DecompressionStream', async () => {
    const sha = 'b'.repeat(40)
    const bytes = await gzip(tar(`translations-${sha}`, {
      'fr/segments/1d/1d4e5186ed79d236.json': JSON.stringify({ hash: '1d4e5186ed79d236' }),
      '.diglot/manifest/docs.json': JSON.stringify({ version: 1, source: 'docs', files: {} }),
      'fr/locale.yml': 'mt: {}\n',
    }, { sha }))
    const archive = await readArchive(chunked(bytes, 100))
    expect(archive.sha).toBe(sha)
    expect(archive.records.get('fr')?.get('1d4e5186ed79d236')).toEqual({ hash: '1d4e5186ed79d236' })
    expect([...archive.manifests.keys()]).toEqual(['docs'])
    expect([...archive.files.keys()]).toEqual(['fr/locale.yml'])
    expect(archiveLocaleState(archive, 'fr')).toEqual({ mt: {} })
    expect(parseRecordPath('fr/segments/1d/1d4e5186ed79d236.json')).toEqual({ locale: 'fr', hash: '1d4e5186ed79d236' })
    expect(parseRecordFile('{}')).toBeUndefined()
    await expect(readArchive(bytes.slice(0, bytes.length - 20))).rejects.toThrow()
  })
})
