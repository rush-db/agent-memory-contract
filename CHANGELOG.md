# @rushdb/agent-memory-contract

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
