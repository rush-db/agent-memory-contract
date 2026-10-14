---
'@rushdb/agent-memory-contract': minor
---

Memory works on a standalone RushDB engine. `RushDBAgentMemory` takes `engineUrl`, `engineToken` and
`scope` to connect to one, and an optional `embedder` (`{ dimensions, similarity?, embed(texts) }`):
with it, `ensureIndexes()` creates external indexes, episodes and facts are written with their
vectors, and `recall()` searches with the embedded query. `createOpenAICompatibleEmbedder` builds one for any
OpenAI-compatible embeddings endpoint. A standalone engine has no managed
embeddings, so the constructor refuses one without an `embedder`. Requires
`@rushdb/javascript-sdk` 3.
