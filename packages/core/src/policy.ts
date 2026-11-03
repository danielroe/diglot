import type { SegmentKind } from './types.ts'
import { hashSkeleton } from './segment.ts'

/** Markdown that every adapter uses as the source of hard break placeholders. */
export const BREAK_SOURCE = ' :br '

/** Input for a context salt: enough to tell apart short strings that need different translations. */
export interface SaltInput {
  kind: SegmentKind
  skeleton: string
  file: string
  containers: string[]
  headingTrail: string[]
  detail?: string
}

/** What an adapter extracts and how it classifies units. */
export interface Policy {
  /** Component props whose string values are prose, by component name. Anything not listed is not translated. */
  props: Record<string, string[]>
  /** Containers that only lay out their children; paragraphs inside them stay `paragraph`. */
  layout: string[]
  /** HTML elements whose text content is translated as `html-block` units. */
  htmlText: string[]
  /** Frontmatter paths that carry prose. `[]` walks every array item, for example `links[].label`. */
  frontmatter: string[]
  /** Keys of `.navigation.yml` files that carry prose. */
  navigation: string[]
  /** Decides whether a code block label reads as prose (`Directory Structure`) rather than a path. */
  codeLabel: (label: string) => boolean
  /** Extract comments from fenced code blocks. */
  codeComments: boolean
  /** Returns a context salt for a segment; `undefined` keeps the global hash. */
  salt?: (input: SaltInput) => string | undefined
}

/** Defaults for Nuxt UI / MDC prose components. */
export const defaultPolicy: Policy = {
  props: {
    'read-more': ['title'],
    'card': ['title', 'description'],
    'video-accordion': ['title'],
    'u-button': ['label'],
    'collapsible': ['name'],
  },
  layout: ['steps', 'card-group', 'code-group'],
  htmlText: ['summary', 'div', 'details', 'figcaption', 'dt', 'dd'],
  frontmatter: ['title', 'description', 'navigation.title', 'head.title', 'links[].label', 'seo.title', 'seo.description'],
  navigation: ['title', 'titleTemplate', 'description'],
  codeLabel: isProseCodeLabel,
  codeComments: true,
}

/** Fills a partial policy from `defaultPolicy`. */
export function resolvePolicy(policy: Partial<Policy> = {}): Policy {
  return { ...defaultPolicy, ...policy }
}

type PolicyFunction = 'codeLabel' | 'salt'

/** The serialisable part of a policy and a fingerprint of all of it, as written to `.diglot/policy.json`. */
export interface PolicySnapshot extends Pick<Policy, 'props' | 'layout' | 'htmlText' | 'frontmatter' | 'navigation' | 'codeComments'> {
  version: 1
  /** `policyFingerprint` of the policy. */
  fingerprint: string
  /** Functions that differ from `defaultPolicy`. A snapshot cannot hold them: `restorePolicy` needs them passed in. */
  custom?: PolicyFunction[]
}

const CODE_LABEL_PROBES = ['Directory Structure', 'Before', 'After', 'Terminal', 'Example', 'nuxt.config.ts', 'app/pages/index.vue', 'components/[slug].vue', '~/server/api', '.env', 'package.json', 'npm', 'pnpm', 'bun']
const SALT_PROBES: SaltInput[] = [
  { kind: 'heading', skeleton: 'Options', file: 'docs/1.guide/1.index.md', containers: [], headingTrail: ['Guide'], detail: 'h2' },
  { kind: 'paragraph', skeleton: 'Read more.', file: 'docs/1.guide/1.index.md', containers: ['callout'], headingTrail: ['Guide', 'Options'] },
  { kind: 'table-cell', skeleton: 'Type', file: 'docs/2.api/1.config.md', containers: ['table'], headingTrail: ['Config'] },
  { kind: 'prop', skeleton: 'Name', file: 'docs/2.api/2.components.md', containers: ['card'], headingTrail: ['Components'], detail: 'title' },
  { kind: 'frontmatter', skeleton: 'Introduction', file: 'docs/index.md', containers: [], headingTrail: [], detail: 'title' },
  { kind: 'navigation', skeleton: 'Get Started', file: 'docs/1.getting-started/.navigation.yml', containers: [], headingTrail: [], detail: 'title' },
  { kind: 'code-label', skeleton: 'Directory Structure', file: 'docs/1.guide/2.structure.md', containers: [], headingTrail: ['Structure'] },
]

function policyData(policy: Policy): Omit<PolicySnapshot, 'version' | 'fingerprint'> {
  const custom = ([['codeLabel', policy.codeLabel !== isProseCodeLabel], ['salt', Boolean(policy.salt)]] as const).filter(([, is]) => is).map(([name]) => name)
  const { props, layout, htmlText, frontmatter, navigation, codeComments } = policy
  return { props, layout, htmlText, frontmatter, navigation, codeComments, ...(custom.length ? { custom } : {}) }
}

function fingerprint(policy: Policy, data: Omit<PolicySnapshot, 'version' | 'fingerprint'>): string {
  const sorted = (list: string[]) => [...list].sort()
  const canonical = {
    ...data,
    props: Object.keys(data.props).sort().map(name => [name, sorted(data.props[name]!)]),
    layout: sorted(data.layout),
    htmlText: sorted(data.htmlText),
    frontmatter: sorted(data.frontmatter),
    navigation: sorted(data.navigation),
  }
  const probes = [CODE_LABEL_PROBES.map(label => policy.codeLabel(label)), SALT_PROBES.map(input => policy.salt?.(input) ?? null)]
  return hashSkeleton(JSON.stringify([canonical, probes]))
}

/**
 * A fingerprint of everything in `policy` that changes what is extracted or how it hashes.
 * Functions are compared by their results on a fixed set of inputs, so two functions that agree
 * on those inputs share a fingerprint.
 */
export function policyFingerprint(policy: Partial<Policy> = {}): string {
  const resolved = resolvePolicy(policy)
  return fingerprint(resolved, policyData(resolved))
}

/** The serialisable part of a policy, with its fingerprint. */
export function snapshotPolicy(policy: Partial<Policy> = {}): PolicySnapshot {
  const resolved = resolvePolicy(policy)
  const data = policyData(resolved)
  return { version: 1, fingerprint: fingerprint(resolved, data), ...data }
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function isSnapshot(value: PolicySnapshot): boolean {
  const props = value?.props as unknown
  return value?.version === 1
    && typeof value.fingerprint === 'string'
    && !!props && typeof props === 'object' && !Array.isArray(props) && Object.values(props).every(isStrings)
    && isStrings(value.layout) && isStrings(value.htmlText) && isStrings(value.frontmatter) && isStrings(value.navigation)
    && typeof value.codeComments === 'boolean'
    && (value.custom === undefined || isStrings(value.custom))
}

/**
 * The policy a snapshot was taken of, with `functions` for the ones listed in `custom`. Throws
 * when the snapshot is malformed, a custom function is not passed, or the restored policy has a
 * different fingerprint.
 */
export function restorePolicy(snapshot: PolicySnapshot, functions: Partial<Pick<Policy, PolicyFunction>> = {}): Policy {
  if (!isSnapshot(snapshot))
    throw new Error('unsupported policy snapshot')
  const missing = (snapshot.custom ?? []).filter(name => !functions[name])
  if (missing.length)
    throw new Error(`the policy has a custom ${missing.join(' and ')} function: pass ${missing.length > 1 ? 'them' : 'it'} to restorePolicy`)
  const policy: Policy = {
    props: snapshot.props,
    layout: snapshot.layout,
    htmlText: snapshot.htmlText,
    frontmatter: snapshot.frontmatter,
    navigation: snapshot.navigation,
    codeComments: snapshot.codeComments,
    codeLabel: functions.codeLabel ?? isProseCodeLabel,
    ...(functions.salt ? { salt: functions.salt } : {}),
  }
  if (policyFingerprint(policy) !== snapshot.fingerprint)
    throw new Error('the restored policy does not match the snapshot fingerprint')
  return policy
}

/** Prose props of a component under `policy`, matching kebab-case and camelCase names. */
export function proseProps(policy: Policy, component: string): string[] {
  return policy.props[kebabCase(component)] ?? []
}

/** Classifies a markdown unit by its nearest non-layout container. */
export function kindForContainers(containers: string[], policy: Policy = defaultPolicy): SegmentKind {
  let i = containers.length - 1
  while (i >= 0 && policy.layout.includes(containers[i]!))
    i--
  const parent = containers[i]
  if (!parent)
    return 'paragraph'
  if (parent === 'li')
    return 'list-item'
  if (parent === 'blockquote')
    return 'blockquote'
  if (policy.htmlText.includes(parent))
    return 'html-block'
  return 'component-slot'
}

/** Code block labels that read as prose (`Directory Structure`, `Before`) rather than file names. */
export function isProseCodeLabel(label: string): boolean {
  return /^(?=.*\s|[A-Z])[^./\\[\]~]+$/.test(label) && !/^(?:npm|yarn|pnpm|bun|deno)$/.test(label)
}

/** Converts `videoId` and `video_id` to `video-id`. */
export function kebabCase(name: string): string {
  return name.replace(/([a-z\d])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase()
}
