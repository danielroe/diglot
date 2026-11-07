/** Tailwind palettes that can stand in for the primary colour. */
export type Accent = 'lime' | 'emerald' | 'teal' | 'cyan' | 'amber' | 'violet' | 'rose' | 'pink' | 'blue' | 'orange'

export interface TopicPackage {
  name: string
  /** Pages under this path take the package's own accent. */
  path: string
  accent: Accent
}

export interface Topic {
  /** First path segment of the topic's pages. */
  slug: string
  title: string
  /** Shown under the title in the sidebar. */
  meta: string
  accent: Accent
  packages: TopicPackage[]
}

/**
 * Every topic has its own colour, and packages that share a topic get neighbouring hues. The
 * documentation takes on the colour of the topic or package you are reading.
 */
export const TOPICS: Topic[] = [
  { slug: 'guide', title: 'Guide', meta: 'Concepts and guides', accent: 'lime', packages: [] },
  { slug: 'core', title: 'Core', meta: '@diglot/core', accent: 'lime', packages: [] },
  {
    slug: 'adapters',
    title: 'Adapters',
    meta: 'comark, mdast and code',
    accent: 'teal',
    packages: [
      { name: '@diglot/comark', path: '/adapters/comark', accent: 'emerald' },
      { name: '@diglot/mdast', path: '/adapters/mdast', accent: 'teal' },
      { name: '@diglot/code', path: '/adapters/code', accent: 'cyan' },
    ],
  },
  { slug: 'store', title: 'Store', meta: '@diglot/store', accent: 'amber', packages: [] },
  { slug: 'machine-translation', title: 'Machine translation', meta: '@diglot/mt', accent: 'violet', packages: [] },
  {
    slug: 'workflow',
    title: 'Workflow',
    meta: 'cli and action',
    accent: 'rose',
    packages: [
      { name: '@diglot/cli', path: '/workflow/cli', accent: 'rose' },
      { name: '@diglot/action', path: '/workflow/action', accent: 'pink' },
    ],
  },
  { slug: 'review-ui', title: 'Review UI', meta: '@diglot/x18n', accent: 'blue', packages: [] },
  { slug: 'integrations', title: 'Integrations', meta: 'angular and astro', accent: 'orange', packages: [] },
]

/** The topic a path belongs to, by its first segment. */
export function topicForPath(path: string): Topic | undefined {
  const slug = path.split('/')[1]
  return TOPICS.find(topic => topic.slug === slug)
}

/** The accent of the topic or package a path belongs to. Other pages keep the brand colour. */
export function accentForPath(path: string): Accent {
  const topic = topicForPath(path)
  if (!topic)
    return 'lime'
  return topic.packages.find(pkg => path === pkg.path || path.startsWith(`${pkg.path}/`))?.accent ?? topic.accent
}

/** The favicon of the topic a path belongs to. The landing page and the guide use the main logo. */
export function faviconForPath(path: string): string {
  const topic = topicForPath(path)
  return topic && topic.slug !== 'guide' ? `/favicons/${topic.slug}.svg` : '/favicons/main.svg'
}

/** The accent of a topic by its slug. */
export function accentForTopic(slug: string): Accent {
  return TOPICS.find(topic => topic.slug === slug)?.accent ?? 'lime'
}
