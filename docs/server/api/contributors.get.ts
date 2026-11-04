import { getContributors } from '../utils/contributors.ts'

export default defineEventHandler(async (event) => {
  const { githubToken } = useRuntimeConfig(event)
  return getContributors(githubToken).catch(() => [])
})
