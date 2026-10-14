import type { MemoryEmbedder } from './client.js'

export interface OpenAICompatibleEmbedderConfig {
  /** The provider's API base; `/embeddings` is appended. Defaults to OpenAI's. */
  baseUrl?: string
  apiKey: string
  /** Provider model id, e.g. `text-embedding-3-small` or `openai/text-embedding-3-small`. */
  model: string
  /** Vector length to request and to expect back. */
  dimensions: number
  similarity?: 'cosine' | 'euclidean'
  /** The `fetch` to use; defaults to the global one. */
  fetch?: typeof fetch
}

/**
 * An embedder for any OpenAI-compatible embeddings endpoint (OpenAI,
 * OpenRouter, Azure OpenAI, Ollama, ...), requesting what RushDB Cloud
 * requests: `POST <baseUrl>/embeddings` with `{ model, input, dimensions }`.
 */
export function createOpenAICompatibleEmbedder(config: OpenAICompatibleEmbedderConfig): MemoryEmbedder {
  if (!config.apiKey || !config.model || !Number.isInteger(config.dimensions) || config.dimensions <= 0) {
    throw new Error('An embedder needs an API key, a model, and a positive integer number of dimensions')
  }
  const url = `${(config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/embeddings`
  const send = config.fetch ?? fetch
  return {
    dimensions: config.dimensions,
    similarity: config.similarity ?? 'cosine',
    async embed(texts: string[]): Promise<number[][]> {
      const response = await send(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, input: texts, dimensions: config.dimensions })
      })
      if (!response.ok) {
        throw new Error(`embedding request failed: ${response.status} ${await response.text()}`)
      }
      const body = (await response.json()) as { data?: Array<{ index?: number; embedding?: number[] }> }
      const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const vectors = rows.map((row) => row.embedding ?? [])
      if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== config.dimensions)) {
        throw new Error(
          `embedding provider returned ${vectors.length} vectors for ${texts.length} texts, expected ${config.dimensions} dimensions each`
        )
      }
      return vectors
    }
  }
}
