interface GitHubContributor {
  login: string
  type: string
  contributions: number
  avatar_url: string
  html_url: string
}

export interface Contributor {
  login: string
  contributions: number
  avatarUrl: string
  url: string
}

export const getContributors = defineCachedFunction(async (token: string): Promise<Contributor[]> => {
  const response = await fetch('https://api.github.com/repos/danielroe/diglot/contributors?per_page=100', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'diglot-docs',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok)
    throw new Error(`GitHub responded with ${response.status}`)

  const data = await response.json() as GitHubContributor[]
  return data
    .filter(contributor => contributor.type === 'User' && !contributor.login.endsWith('[bot]'))
    .sort((a, b) => b.contributions - a.contributions)
    .map(contributor => ({
      login: contributor.login,
      contributions: contributor.contributions,
      avatarUrl: contributor.avatar_url,
      url: contributor.html_url,
    }))
}, {
  name: 'github-contributors',
  maxAge: 60 * 60,
  getKey: () => 'danielroe-diglot',
})
