import { Marked } from 'marked'
import { parse } from 'yaml'

export interface RenderedPage {
  title: string
  description: string
  html: string
}

/** Renders a page's Markdown, with relative links pointing to the same locale. */
export function renderPage(markdown: string, locale: string): RenderedPage {
  const [, frontmatter = '', body = markdown] = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/) ?? []
  const data = (parse(frontmatter) ?? {}) as Partial<RenderedPage>
  const marked = new Marked({
    walkTokens: (token) => {
      if (token.type === 'link' && !/^(?:[a-z]+:|\/|#)/i.test(token.href))
        token.href = `/${locale}/${token.href}`
    },
  })
  return { title: data.title ?? '', description: data.description ?? '', html: marked.parse(body, { async: false }) }
}
