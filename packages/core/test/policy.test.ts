import type { SaltInput } from '../src/index.ts'
import { describe, expect, it } from 'vitest'
import { defaultPolicy, policyFingerprint, resolvePolicy, restorePolicy, snapshotPolicy } from '../src/index.ts'

const salt = ({ kind }: SaltInput) => kind === 'table-cell' ? 'cell' : undefined

describe('policy snapshots', () => {
  it('should fingerprint what changes extraction, not the order of lists', () => {
    expect(policyFingerprint()).toBe(policyFingerprint(defaultPolicy))
    expect(policyFingerprint({ layout: [...defaultPolicy.layout].reverse() })).toBe(policyFingerprint())
    expect(policyFingerprint({ props: { ...defaultPolicy.props, 'u-badge': ['label'] } })).not.toBe(policyFingerprint())
    expect(policyFingerprint({ codeComments: false })).not.toBe(policyFingerprint())
    expect(policyFingerprint({ codeLabel: () => true })).not.toBe(policyFingerprint())
    expect(policyFingerprint({ salt })).not.toBe(policyFingerprint())
    expect(policyFingerprint({ salt: ({ kind }) => kind === 'table-cell' ? 'cell' : undefined })).toBe(policyFingerprint({ salt }))
  })

  it('should restore a policy from its JSON snapshot', () => {
    const policy = resolvePolicy({ frontmatter: ['title'] })
    const snapshot = JSON.parse(JSON.stringify(snapshotPolicy(policy)))
    expect(snapshot).toMatchObject({ version: 1, fingerprint: policyFingerprint(policy), frontmatter: ['title'] })
    expect(snapshot.custom).toBeUndefined()
    expect(policyFingerprint(restorePolicy(snapshot))).toBe(policyFingerprint(policy))
  })

  it('should require custom functions and detect mismatches', () => {
    const snapshot = snapshotPolicy({ salt })
    expect(snapshot.custom).toEqual(['salt'])
    expect(() => restorePolicy(snapshot)).toThrow('custom salt function')
    expect(() => restorePolicy(snapshot, { salt: () => 'other' })).toThrow('does not match')
    expect(restorePolicy(snapshot, { salt }).salt).toBe(salt)
    expect(() => restorePolicy({ ...snapshotPolicy(), layout: [] })).toThrow('does not match')
    expect(() => restorePolicy({} as never)).toThrow('unsupported')
    expect(() => restorePolicy({ ...snapshotPolicy(), props: null } as never)).toThrow('unsupported')
    expect(() => restorePolicy({ ...snapshotPolicy(), layout: 'steps' } as never)).toThrow('unsupported')
  })
})
