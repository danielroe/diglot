import type { SegmentKind } from './types.ts'

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

/** Prose props of a component under `policy`, matching kebab-case and camelCase names. */
export function proseProps(policy: Policy, component: string): string[] {
  return policy.props[kebabCase(component)] ?? []
}

/** Classifies a markdown unit by its nearest non-layout container. */
export function kindForContainers(containers: string[], policy: Policy = defaultPolicy): SegmentKind {
  const parent = containers.findLast(c => !policy.layout.includes(c))
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
