import type { Manifest } from './manifest-data.ts'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'pathe'
import { serialiseManifest } from './manifest-data.ts'

/** Path of a source's manifest inside the state directory. */
export function manifestPath(stateDir: string, source: string): string {
  return join(stateDir, 'manifest', `${source}.json`)
}

export async function readManifest(stateDir: string, source: string): Promise<Manifest | undefined> {
  const content = await readFile(manifestPath(stateDir, source), 'utf8').catch(() => undefined)
  if (content === undefined)
    return
  const manifest = JSON.parse(content) as Manifest
  if (manifest.version !== 1 || typeof manifest.files !== 'object')
    throw new Error(`${manifestPath(stateDir, source)}: unsupported manifest`)
  return manifest
}

export async function writeManifest(stateDir: string, manifest: Manifest): Promise<string> {
  const path = manifestPath(stateDir, manifest.source)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, serialiseManifest(manifest))
  return path
}

/** Reads every manifest in the state directory. */
export async function readManifests(stateDir: string): Promise<Manifest[]> {
  const names = await readdir(join(stateDir, 'manifest')).catch(() => [] as string[])
  const manifests: Manifest[] = []
  for (const name of names.filter(n => n.endsWith('.json')).sort()) {
    const manifest = await readManifest(stateDir, name.slice(0, -5))
    if (manifest)
      manifests.push(manifest)
  }
  return manifests
}
