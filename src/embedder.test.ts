import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatibleEmbedder } from './embedder.js'

describe('createOpenAICompatibleEmbedder', () => {
  it('requests what RushDB Cloud requests and returns vectors in input order', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] }
          ]
        })
      )
    )
    const embedder = createOpenAICompatibleEmbedder({
      baseUrl: 'https://provider.example/v1/',
      apiKey: 'key',
      model: 'm',
      dimensions: 2,
      fetch: fetch as never
    })
    expect(await embedder.embed(['a', 'b'])).toEqual([
      [1, 0],
      [0, 1]
    ])
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://provider.example/v1/embeddings')
    expect(JSON.parse(String(init.body))).toEqual({ model: 'm', input: ['a', 'b'], dimensions: 2 })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key')
  })

  it('rejects vectors of the wrong length', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] })))
    const embedder = createOpenAICompatibleEmbedder({ apiKey: 'k', model: 'm', dimensions: 2, fetch: fetch as never })
    await expect(embedder.embed(['a'])).rejects.toThrow(/expected 2 dimensions/)
  })

  it('needs a key, a model and dimensions', () => {
    expect(() => createOpenAICompatibleEmbedder({ apiKey: '', model: 'm', dimensions: 2 })).toThrow()
    expect(() => createOpenAICompatibleEmbedder({ apiKey: 'k', model: 'm', dimensions: 0 })).toThrow()
  })
})
