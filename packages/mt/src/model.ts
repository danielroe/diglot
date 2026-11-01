import type { GatewayProviderSettings } from '@ai-sdk/gateway'
import type { LanguageModel } from 'ai'
import type { z } from 'zod'
import type { Pricing, Usage } from './types.ts'
import process from 'node:process'
import { createGateway } from '@ai-sdk/gateway'
import { generateText, NoObjectGeneratedError, Output } from 'ai'

/** Environment variable holding the default model id. */
export const MODEL_ENV = 'DIGLOT_MT_MODEL'

/**
 * A model served by the Vercel AI Gateway. The API key defaults to the `AI_GATEWAY_API_KEY`
 * environment variable.
 */
export function gatewayModel(id: string, settings: GatewayProviderSettings = {}): LanguageModel {
  return createGateway(settings)(id)
}

/** Resolves a model option: an instance, a gateway model id, or `DIGLOT_MT_MODEL`. */
export function resolveModel(model: LanguageModel | undefined): Exclude<LanguageModel, string> {
  const resolved = model ?? process.env[MODEL_ENV]
  if (!resolved)
    throw new Error(`no model: pass \`model\` or set ${MODEL_ENV}`)
  return (typeof resolved === 'string' ? gatewayModel(resolved) : resolved) as Exclude<LanguageModel, string>
}

export function emptyUsage(): Usage {
  return { requests: 0, inputTokens: 0, outputTokens: 0 }
}

/** Adds `b` into `a`. */
export function addUsage(a: Usage, b: Usage): Usage {
  a.requests += b.requests
  a.inputTokens += b.inputTokens
  a.outputTokens += b.outputTokens
  if (b.costUsd !== undefined)
    a.costUsd = round((a.costUsd ?? 0) + b.costUsd)
  return a
}

function round(n: number): number {
  return Math.round(n * 1e8) / 1e8
}

function reportedCost(metadata: unknown): number | undefined {
  const cost = (metadata as { gateway?: { cost?: unknown } } | undefined)?.gateway?.cost
  const n = typeof cost === 'string' ? Number(cost) : cost
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

export interface GenerateOptions<T> {
  model: Exclude<LanguageModel, string>
  system: string
  prompt: string
  schema: z.ZodType<T>
  usage: Usage
  pricing?: Pricing
  signal?: AbortSignal
}

/**
 * One structured-output request. Usage and cost are added to `usage`. Resolves to `undefined`
 * when the model's output does not match the schema; other errors are thrown.
 */
export async function generate<T>(options: GenerateOptions<T>): Promise<T | undefined> {
  let output: T
  try {
    const result = await generateText({
      model: options.model,
      system: options.system,
      prompt: options.prompt,
      output: Output.object({ schema: options.schema }),
      maxRetries: 2,
      ...(options.signal ? { abortSignal: options.signal } : {}),
    })
    record(options, result.usage, result.providerMetadata)
    output = result.output as T
  }
  catch (error) {
    const usage = (error as { usage?: { inputTokens?: number, outputTokens?: number } }).usage
    record(options, usage)
    if (NoObjectGeneratedError.isInstance(error))
      return undefined
    throw error
  }
  return output
}

function record(options: GenerateOptions<unknown>, usage: { inputTokens?: number, outputTokens?: number } | undefined, metadata?: unknown): void {
  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const cost = reportedCost(metadata) ?? (options.pricing ? (inputTokens * options.pricing.input + outputTokens * options.pricing.output) / 1e6 : undefined)
  addUsage(options.usage, { requests: 1, inputTokens, outputTokens, ...(cost === undefined ? {} : { costUsd: cost }) })
}
