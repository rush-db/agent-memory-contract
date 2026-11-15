import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createEpisodeEvent, createFactEvent, episodeEventId, stableStringify } from './canonical.js'
import type { AgentMemoryEpisodeInput, AgentMemoryRuntime } from './types.js'

interface ConformanceCase {
  episodeInput: AgentMemoryEpisodeInput
  expectedEventId: string
}

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/conformance.v1.json', import.meta.url)), 'utf8')
) as ConformanceCase & { runtimeCases: ConformanceCase[] }

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schema/agent-memory-event.v1.schema.json', import.meta.url)), 'utf8')
) as { $defs: Record<string, { allOf: Array<{ properties?: { runtime?: { enum: string[] } } }> }> }

const runtimes: AgentMemoryRuntime[] = ['openclaw', 'hermes', 'dsh', 'custom']

function schemaRuntimeEnum(definition: string): string[] | undefined {
  return schema.$defs[definition].allOf.find((part) => part.properties?.runtime)?.properties?.runtime?.enum
}

describe('AgentMemoryEvent v1 canonical identity', () => {
  it('is stable across object key ordering', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}')
  })

  it('matches the language-neutral conformance fixture', () => {
    expect(episodeEventId(fixture.episodeInput)).toBe(fixture.expectedEventId)
    expect(createEpisodeEvent(fixture.episodeInput).schemaVersion).toBe(1)
  })

  it('matches every per-runtime conformance case', () => {
    expect(fixture.runtimeCases.map((entry) => entry.episodeInput.runtime)).toContain('dsh')
    for (const entry of fixture.runtimeCases) {
      expect(episodeEventId(entry.episodeInput)).toBe(entry.expectedEventId)
      expect(createEpisodeEvent(entry.episodeInput).runtime).toBe(entry.episodeInput.runtime)
    }
  })

  it('gives the same turn a different identity per runtime', () => {
    const [dshCase] = fixture.runtimeCases
    expect(episodeEventId({ ...dshCase.episodeInput, runtime: 'custom' })).not.toBe(dshCase.expectedEventId)
  })

  it('creates dsh fact events', () => {
    const fact = createFactEvent({
      runtime: 'dsh',
      agentId: 'coder',
      profileId: 'default',
      privacyScope: 'private',
      participantScopeHash: fixture.episodeInput.participantScopeHash,
      sandboxEligible: false,
      text: 'The user prefers TypeScript for this service.',
      kind: 'preference',
      subjectKey: 'language',
      confidence: 0.9,
      active: true,
      sourceEventId: fixture.runtimeCases[0].expectedEventId,
      validFrom: '2026-08-18T00:00:00Z',
      visibility: 'participant',
      trustClass: 'mixed',
      provenance: 'dsh:turn_end'
    })
    expect(fact.runtime).toBe('dsh')
    expect(fact.factId).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('AgentMemoryEvent v1 JSON schema', () => {
  it.each(['episode', 'fact'])('lists every runtime in the %s enum', (definition) => {
    expect(schemaRuntimeEnum(definition)).toEqual(runtimes)
  })
})
