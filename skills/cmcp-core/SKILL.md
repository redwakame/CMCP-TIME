---
name: cmcp-core
description: Review and implement the existing CMCP guarded write and continuity contract, independent of the hosting application. Use when defining, reviewing, or implementing what enters session, staged, tracked, daily memory, or long-term personalization; what is forbidden to store; how /new carries continuity; how onboarding creates initial memory; how users correct memory; or how UI, addons, installer flows, product pages, and V2 runtime should map to the same policy without inventing new rules.
metadata: {"scope":"cmcp-core-policy"}
---

# CMCP Core

This skill is the canonical policy baseline for continuity memory behavior.

Use it when the task involves:

- memory layer definitions
- write and promotion rules
- forbidden write boundaries
- `/new` continuity selection
- onboarding-derived memory
- user correction and deletion semantics
- mapping the same contract into UI, addons, installer flows, product pages, or legacy V2 behavior

## Single source of truth

Read these files first:

- `{baseDir}/contract/cmcp-contract-v1.yaml`
- `{baseDir}/contract/cmcp-runtime-policy.json`
- `{baseDir}/contract/cmcp-surface-map.yaml`
- `{baseDir}/contract/cmcp-host-integration-v1.yaml`

Use these schemas when an implementation needs validation or typed payloads:

- `{baseDir}/schemas/cmcp-memory-record.schema.json`
- `{baseDir}/schemas/cmcp-continuity-context.schema.json`
- `{baseDir}/schemas/cmcp-correction-action.schema.json`
- `{baseDir}/schemas/cmcp-write-decision.schema.json`
- `{baseDir}/schemas/cmcp-storage-adapter-descriptor.schema.json`
- `{baseDir}/schemas/cmcp-persistence-result.schema.json`

## Hard rules

1. The contract files are canonical. UI, addons, installer flows, product pages, and V2 integrations must map to them rather than inventing new policy.
2. Settings are not memory. Some fields may exist in both settings and long-term personalization, but they remain separate writes.
3. Default user mode is `content_read_only_no_write`. Ordinary chat must not create persistent memory unless the interaction is inside an authorized write invocation area.
4. `session` is ephemeral working context. It is not persistent truth.
5. `staged` stores unresolved continuity with short-to-medium retention, but only when an authorized write invocation area explicitly enables it.
6. `tracked` stores formal follow-up lines that should survive `/new`, but only when an authorized write invocation area explicitly enables it.
7. `daily_memory` is derived writeback and audit context. It is never the primary truth source when structured state still exists.
8. `long_term_personalization` stores only stable, low-risk, user-owned profile preferences, and restricted fields require explicit user ownership plus a disclosed write surface.
9. Guided settings and operator feedback are never `/new` anchors.
10. Forbidden writes never persist, even if they appear in chat.
11. Explicit user correction overrides older memory, older summaries, and assistant inference.

## Required workflow

1. Classify the input as settings, memory, forbidden content, or correction.
2. Decide the correct layer: `session`, `staged`, `tracked`, `daily_memory`, `long_term_personalization`, or no persistent write.
3. Explain why a record is persisted or rejected using the contract criteria.
4. For `/new`, prefer active unresolved `tracked`, then recent unresolved `staged`, then linked `daily_memory`, with long-term personalization as background only.
5. When implementing a surface:
   - use `cmcp-surface-map.yaml` to determine ownership
   - do not move canonical policy into UI copy or installer prose
6. When implementing a host runtime or storage backend:
   - use `cmcp-host-integration-v1.yaml` to preserve adapter semantics and fail-closed behavior
   - do not bind policy logic directly to a database or file path
7. If legacy V2 behavior conflicts with the contract, treat it as drift to fix. Do not enlarge the contract just to match old behavior.

## Output discipline

When answering tasks in this area, always make the following explicit:

- chosen layer
- write reason or rejection reason
- `/new` impact
- correction path
- owning surface for implementation

If a task needs more detail than the skill body provides, load the contract YAML. Do not expand policy from memory or from marketing copy.
