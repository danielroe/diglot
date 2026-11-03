import type { Policy, PolicySnapshot } from '@diglot/core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { snapshotPolicy } from '@diglot/core'
import { dirname, join } from 'pathe'

/** Path of the policy snapshot inside the state directory. */
export function policyPath(stateDir: string): string {
  return join(stateDir, 'policy.json')
}

/** Writes the snapshot of `policy` that runtime consumers restore with `restorePolicy`. */
export async function writePolicy(stateDir: string, policy: Partial<Policy>): Promise<string> {
  const path = policyPath(stateDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(snapshotPolicy(policy), null, 2)}\n`)
  return path
}

/** Reads the policy snapshot, or `undefined` when there is none. */
export async function readPolicy(stateDir: string): Promise<PolicySnapshot | undefined> {
  const content = await readFile(policyPath(stateDir), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return undefined
    throw error
  })
  return content === undefined ? undefined : JSON.parse(content) as PolicySnapshot
}
