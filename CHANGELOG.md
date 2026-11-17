# @rushdb/agent-memory-contract

## 0.4.0

### Minor Changes

- b942485: Add `'dsh'` to the `AgentMemoryRuntime` union and to the `runtime` enum of the v1 episode and fact schemas, and add a dsh case to the conformance fixture (`runtimeCases`). This is a backward-compatible enum addition: existing runtimes, event identities and the fixture's top-level case are unchanged. Consumers that switch exhaustively over `AgentMemoryRuntime` need a `'dsh'` branch.

## 0.3.1

### Patch Changes

- 4702982: Docs and package metadata only: the README, description and keywords use RushDB's current wording, and the README has a compatibility table. No code changes.

## 0.3.0

### Minor Changes

- ace92c5: Memory works on a standalone RushDB engine. `RushDBAgentMemory` takes `engineUrl`, `engineToken` and
  `scope` to connect to one, and an optional `embedder` (`{ dimensions, similarity?, embed(texts) }`):
  with it, `ensureIndexes()` creates external indexes, episodes and facts are written with their
  vectors, and `recall()` searches with the embedded query. `createOpenAICompatibleEmbedder` builds one for any
  OpenAI-compatible embeddings endpoint. A standalone engine has no managed
  embeddings, so the constructor refuses one without an `embedder`. Requires
  `@rushdb/javascript-sdk` 3.

## 0.2.0

### Minor Changes

- 696765a: Fix CI for memory agent contract

## 0.1.0

### Minor Changes

- abeb65c: Update skills for agent memory and add memory contract packages for further integrations.
