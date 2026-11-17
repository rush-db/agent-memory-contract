---
'@rushdb/agent-memory-contract': minor
---

Add `'dsh'` to the `AgentMemoryRuntime` union and to the `runtime` enum of the v1 episode and fact schemas, and add a dsh case to the conformance fixture (`runtimeCases`). This is a backward-compatible enum addition: existing runtimes, event identities and the fixture's top-level case are unchanged. Consumers that switch exhaustively over `AgentMemoryRuntime` need a `'dsh'` branch.
