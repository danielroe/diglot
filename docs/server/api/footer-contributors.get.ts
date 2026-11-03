import { getContributors } from '../utils/contributors.ts'

const SHOWN = 3
// Credited when GitHub can't be reached, for example when its rate limit is exhausted.
const FALLBACK = [{ login: 'danielroe', to: 'https://github.com/danielroe' }]

export default defineCachedEventHandler(async (event) => {
  const { githubToken } = useRuntimeConfig(event)
  const contributors = await getContributors(githubToken).catch(() => [])
  if (!contributors.length)
    return { contributors: FALLBACK, remaining: 0 }
  return {
    contributors: contributors.slice(0, SHOWN).map(({ login, url }) => ({ login, to: url })),
    remaining: Math.max(0, contributors.length - SHOWN),
  }
}, {
  maxAge: 60 * 60,
  getKey: () => 'footer-contributors',
})
