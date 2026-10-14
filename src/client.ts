import RushDB from '@rushdb/javascript-sdk'
import type { DBRecordInstance, DBRecordsArrayInstance } from '@rushdb/javascript-sdk'
import { createEpisodeEvent, createFactEvent } from './canonical.js'
import { boundedText } from './format.js'
import { buildScopeWhere } from './scope.js'
import type {
  AgentMemoryEpisodeInput,
  AgentMemoryEpisodeV1,
  AgentMemoryFactInput,
  AgentMemoryFactV1,
  RecallOptions,
  RecalledMemory
} from './types.js'

type UnknownRecord = DBRecordInstance<any>
type UnknownRecords = DBRecordsArrayInstance<any>

/**
 * Turns text into vectors on the client. With an embedder the memory keeps its
 * own vectors (external indexes); without one it relies on RushDB Cloud's
 * managed embeddings. A standalone engine has no managed embeddings, so it
 * needs an embedder.
 */
export interface MemoryEmbedder {
  /** Length of every vector `embed` returns. */
  dimensions: number
  /** How vectors are compared; defaults to `cosine`. */
  similarity?: 'cosine' | 'euclidean'
  /** One vector per text, in order. */
  embed(texts: string[]): Promise<number[][]>
}

export interface RushDBMemoryClientOptions {
  /** RushDB Cloud API key. */
  apiKey?: string
  /** RushDB Cloud (or self-hosted platform) API URL. */
  url?: string
  /** A standalone engine's URL (direct mode); use with `engineToken`. */
  engineUrl?: string
  /** The standalone engine's token. */
  engineToken?: string
  /** Tenant on a multitenant standalone engine. */
  scope?: string
  /** A client to use as is. */
  db?: RushDB
  /** Client-side embeddings; required on a standalone engine. */
  embedder?: MemoryEmbedder
  recentLimit?: number
}

const MEMORY_INDEXES = [
  { label: 'EPISODE', propertyName: 'summary' },
  { label: 'MEMORY_FACT', propertyName: 'text' }
] as const

export class RushDBAgentMemory {
  private readonly db: RushDB
  private readonly embedder?: MemoryEmbedder
  private readonly recent = new Map<string, AgentMemoryEpisodeV1>()
  private readonly recentLimit: number

  public constructor(options: RushDBMemoryClientOptions) {
    if (options.db) {
      this.db = options.db
    } else if (options.engineUrl) {
      if (!options.engineToken) {
        throw new Error('A standalone engine needs its token: pass `engineToken` with `engineUrl`')
      }
      this.db = new RushDB(options.engineToken, {
        direct: true,
        engineUrl: options.engineUrl,
        ...(options.scope ? { scope: options.scope } : {})
      })
    } else {
      if (!options.apiKey) {
        throw new Error('RUSHDB_API_KEY is required (or `engineUrl` and `engineToken` for a standalone engine)')
      }
      this.db = new RushDB(options.apiKey, options.url ? { url: options.url } : undefined)
    }
    this.embedder = options.embedder
    if (this.db.direct && !this.embedder) {
      throw new Error(
        'A standalone RushDB engine has no managed embeddings: pass an `embedder` so memory can be recalled'
      )
    }
    this.recentLimit = Math.max(1, options.recentLimit ?? 128)
  }

  /**
   * Declares the vector indexes recall uses: managed ones (RushDB Cloud embeds
   * the text), or external ones of the embedder's dimensions.
   */
  public async ensureIndexes(): Promise<void> {
    const indexes = (await this.db.ai.indexes.find()).data ?? []
    for (const candidate of MEMORY_INDEXES) {
      const found = indexes.some(
        (index) =>
          index.label === candidate.label &&
          index.propertyName === candidate.propertyName &&
          (!this.embedder ||
            (index.sourceType === 'external' &&
              Number(index.dimensions) === this.embedder.dimensions &&
              index.similarityFunction === (this.embedder.similarity ?? 'cosine')))
      )
      if (found) continue
      await this.db.ai.indexes.create(
        this.embedder ?
          {
            ...candidate,
            external: true,
            dimensions: this.embedder.dimensions,
            similarityFunction: this.embedder.similarity ?? 'cosine'
          }
        : { ...candidate }
      )
    }
  }

  /** The record's vector for `propertyName`, when the memory embeds on the client. */
  private async vectorsFor(propertyName: 'summary' | 'text', text: string) {
    if (!this.embedder) return undefined
    const [vector] = await this.embedder.embed([boundedText(text, 4000)])
    return [{ propertyName, vector, similarityFunction: this.embedder.similarity ?? 'cosine' }]
  }

  public rememberRecent(input: AgentMemoryEpisodeInput | AgentMemoryEpisodeV1): AgentMemoryEpisodeV1 {
    const episode = 'eventId' in input ? input : createEpisodeEvent(input)
    this.recent.delete(episode.eventId)
    this.recent.set(episode.eventId, episode)
    while (this.recent.size > this.recentLimit) {
      const oldest = this.recent.keys().next().value as string | undefined
      if (!oldest) break
      this.recent.delete(oldest)
    }
    return episode
  }

  public async persistEpisode(
    input: AgentMemoryEpisodeInput | AgentMemoryEpisodeV1
  ): Promise<AgentMemoryEpisodeV1> {
    const episode = this.rememberRecent(input)
    const vectors = await this.vectorsFor('summary', episode.summary)
    await this.db.records.upsert({
      label: 'EPISODE',
      data: { ...episode },
      options: { mergeBy: ['eventId'], mergeStrategy: 'append' },
      ...(vectors ? { vectors } : {})
    })
    return episode
  }

  public async persistFact(input: AgentMemoryFactInput | AgentMemoryFactV1): Promise<AgentMemoryFactV1> {
    const fact = 'factId' in input ? input : createFactEvent(input)
    const vectors = await this.vectorsFor('text', fact.text)
    await this.db.records.upsert({
      label: 'MEMORY_FACT',
      data: { ...fact },
      options: { mergeBy: ['factId'], mergeStrategy: 'append' },
      ...(vectors ? { vectors } : {})
    })
    return fact
  }

  public async recall(options: RecallOptions): Promise<RecalledMemory[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 8, 20))
    const episodeWhere = buildScopeWhere(options, {
      excludeSessionId: options.excludeSessionId
    })
    const factWhere = buildScopeWhere(options, { activeOnly: true })

    const queryVector =
      this.embedder ? (await this.embedder.embed([boundedText(options.query, 4000)]))[0] : undefined
    const searches: Array<Promise<RecalledMemory[]>> = [
      this.vectorRecall('EPISODE', 'summary', episodeWhere, options.query, queryVector, limit)
    ]
    if (options.includeFacts !== false) {
      searches.push(this.vectorRecall('MEMORY_FACT', 'text', factWhere, options.query, queryVector, limit))
    }

    const remote = (await Promise.allSettled(searches)).flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    )
    const recent = this.recallRecent(options, limit)
    const merged = new Map<string, RecalledMemory>()

    for (const memory of [...recent, ...remote]) {
      const previous = merged.get(memory.id)
      if (!previous || memory.score > previous.score) {
        merged.set(memory.id, memory)
      }
    }

    return [...merged.values()].sort((left, right) => right.score - left.score).slice(0, limit)
  }

  public async getEpisode(eventId: string, scope: RecallOptions): Promise<RecalledMemory | null> {
    const result = await this.db.records.find({
      labels: ['EPISODE'],
      where: { ...buildScopeWhere(scope), eventId },
      limit: 1
    })
    const record = result.data[0]
    return record ? this.toRecalledMemory('EPISODE', 'summary', record, 1) : null
  }

  private async vectorRecall(
    label: 'EPISODE' | 'MEMORY_FACT',
    propertyName: 'summary' | 'text',
    where: Record<string, unknown>,
    query: string,
    queryVector: number[] | undefined,
    limit: number
  ): Promise<RecalledMemory[]> {
    const result: UnknownRecords = await this.db.records.vectorSearch({
      labels: [label],
      propertyName,
      ...(queryVector ? { queryVector } : { query: boundedText(query, 4000) }),
      where,
      limit
    })
    return result.data
      .map((record) =>
        this.toRecalledMemory(
          label,
          propertyName,
          record,
          Number((record.data as Record<string, unknown>).__score ?? 0)
        )
      )
      .filter((memory) => memory.text.length > 0)
  }

  private toRecalledMemory(
    label: 'EPISODE' | 'MEMORY_FACT',
    propertyName: 'summary' | 'text',
    record: UnknownRecord,
    score: number
  ): RecalledMemory {
    const data = record.data as Record<string, unknown>
    return {
      id: String(data.eventId ?? data.factId ?? data.__id ?? ''),
      label,
      text: String(data[propertyName] ?? ''),
      score,
      observedAt:
        typeof data.observedAt === 'string' ? data.observedAt
        : typeof data.validFrom === 'string' ? data.validFrom
        : undefined,
      provenance: typeof data.provenance === 'string' ? data.provenance : undefined,
      trustClass:
        data.trustClass === 'trusted' || data.trustClass === 'mixed' || data.trustClass === 'untrusted' ?
          data.trustClass
        : undefined
    }
  }

  private recallRecent(options: RecallOptions, limit: number): RecalledMemory[] {
    const terms = options.query
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter((term) => term.length > 1)

    return [...this.recent.values()]
      .filter(
        (episode) =>
          episode.agentId === options.agentId &&
          episode.profileId === options.profileId &&
          episode.privacyScope === options.privacyScope &&
          episode.participantScopeHash === options.participantScopeHash &&
          episode.sandboxEligible === options.sandboxEligible &&
          episode.externalSessionId !== options.excludeSessionId
      )
      .map((episode) => {
        const haystack = episode.summary.toLocaleLowerCase()
        const matches = terms.filter((term) => haystack.includes(term)).length
        return {
          id: episode.eventId,
          label: 'EPISODE' as const,
          text: episode.summary,
          score: terms.length === 0 ? 0 : Math.min(1, 0.55 + matches / terms.length / 2),
          observedAt: episode.observedAt,
          provenance: episode.provenance,
          trustClass: episode.trustClass
        }
      })
      .filter((memory) => memory.score > 0.55)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }
}
