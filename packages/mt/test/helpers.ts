import type { Segment } from '@diglot/core'
import { extract } from '@diglot/mdast'
import { MockLanguageModelV4 } from 'ai/test'

export async function segments(markdown: string, file = 'page.md'): Promise<Segment[]> {
  return extract(markdown, { file })
}

export async function segment(markdown: string, file = 'page.md'): Promise<Segment> {
  return (await segments(markdown, file))[0]!
}

export interface Call {
  system: string
  user: string
}

export function mockModel(respond: (call: Call, index: number) => unknown, options: { cost?: string } = {}): { model: MockLanguageModelV4, calls: Call[] } {
  const calls: Call[] = []
  const model = new MockLanguageModelV4({
    modelId: 'mock/model',
    async doGenerate({ prompt }) {
      const system = prompt.filter(m => m.role === 'system').map(m => m.content).join('\n')
      const user = prompt.filter(m => m.role === 'user').flatMap(m => m.content.map(p => p.type === 'text' ? p.text : '')).join('\n')
      const call = { system, user }
      calls.push(call)
      const answer = respond(call, calls.length - 1)
      return {
        content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        ...(options.cost ? { providerMetadata: { gateway: { cost: options.cost } } } : {}),
        warnings: [],
      }
    },
  })
  return { model, calls }
}

export function requested(call: Call): Array<{ id: string, kind: string, text: string, format?: string, previous?: string, problems?: string[] }> {
  return JSON.parse(call.user.slice(call.user.indexOf('\n[') + 1))
}
