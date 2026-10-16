# CMCP-TIME

**Keep the original words. Understand the time between them.**

[English](https://github.com/redwakame/CMCP-TIME/blob/main/README.md) · [繁體中文](https://github.com/redwakame/CMCP-TIME/blob/main/README.zh-TW.md) · [Español](https://github.com/redwakame/CMCP-TIME/blob/main/README.es.md) · [日本語](https://github.com/redwakame/CMCP-TIME/blob/main/README.ja.md)

**A time-aware continuity skill for AI agents:** resume a discussion using its original words, images, roles and times, while keeping your existing host and model.

**0.1.1 · Apache-2.0 · Original author: [redwakame](https://github.com/redwakame)**

## Return to the right original

Yesterday you drafted a plan. Today you change one detail. In a new conversation, CMCP helps retrieve both versions and distinguish a User decision from an Assistant suggestion. An image revision keeps its original file and source relationship, not just a caption.

![Illustrative original, revision and formal retrieval across conversations](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/continuity-source-flow.png)

Σ represents the idea of a derived summary; this diagram does not announce a new summary feature.

The diagram is an explanation, not a recorded model result. CMCP supplies source material; it does not replace the host's reasoning or rewrite its final answer. Models can still misinterpret correct sources.

## Install 0.1.1 from npm

Install the fixed version [`@redwakame-skill/cmcp-time@0.1.1`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.1) from the official npm registry. The earlier [GitHub-only v0.1.1 Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1), its [fixed source tag](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) and four assets remain unchanged. The npm package has the same runtime and contracts, with subsequent publication settings and installation documents; its bytes/hash and exact source commit differ. See the [channel and source-identity guide](https://github.com/redwakame/CMCP-TIME/blob/main/docs/npm-installation.md#version-and-publication-evidence).

Prepare Node.js **22.16.0 or newer** and npm. Choose two persistent directories: one for installed code, another for authorized workspace data. PowerShell example; no administrator or global PATH change is required:

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-0.1.1'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

The wizard is for local setup and managed Codex attachment. Official Harness Desktop and optional MCP/Hermes have their own setup steps in the [operating guide](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-readiness.en.md). Installation alone does not attach a host, import private chats, authorize paid model calls or turn on proactive delivery. Keep live integrations out of disposable `npx` caches.

[POSIX, local tarball and update instructions](https://github.com/redwakame/CMCP-TIME/blob/main/docs/npm-installation.md) · [Quick start](https://github.com/redwakame/CMCP-TIME/blob/main/docs/quick-start.md)

**In 0.1.1:** source-bound current plans, reported facts, revision scope and reasons remain distinct. Local setup works without Codex; interactive setup requires a TTY, while automation uses explicit `--answers`. On-demand status retains genuine uncertainty and bounded coverage; structural `ready` is not semantic certification or execution permission. See the [0.1.1 changes and limits](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-0.1.1.md).

## Choose a demonstrated route

![One authorized source store with optional host and MCP connections](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/host-interoperability.png)

Two separately demonstrated sequential routes: Codex ↔ Harness and Hermes ↔ Harness. This is not three-host concurrent validation; dashed MCP is optional and shares the same Core.

| Route | Demonstrated scope | Boundary |
|---|---|---|
| Official DeepSeek Harness Desktop 0.2.0-rc.2 | Native text, image originals, new-conversation retrieval, controls and explicit in-app Pins | Native GUI evidence and isolated SDK evidence are separate; no 24/7 or mobile-delivery promise |
| Codex | Skill/hooks and official app-server text handoff; bounded native compaction | Explicit project/account route; arbitrary App chats are not automatically captured |
| Hermes v2026.9.24 / 0.21.5 | Official headless lifecycle, native tools, text handoff with Harness SDK | External Python/Git Bash dependencies; tested DeepSeek route; not Hermes TUI or Desktop GUI certification |
| MCP stdio / Streamable HTTP | Real clients, formal reading, media handles, scope/revocation and persistent local service | Optional transport; local tests do not prove remote cloud, TLS deployment or platform approval |

OpenClaw, dots, Grok Bot and Muse have different interface/account requirements; see the [capability matrix](https://github.com/redwakame/CMCP-TIME/blob/main/docs/interop-capabilities.zh-TW.md). The latest interoperability increment was tested on Windows Node 24.18.0; earlier Linux/Node 22.16.0 evidence does not certify every new adapter or OS. Four-language documentation is not four-language behavioral certification.

## Use, inspect and stop

![Minimal control entry, on-demand detail, and separate authorization and saving controls](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/controls-modes.png)

Conceptual wireframes, not actual GUI screenshots: 1 minimized, 2 one row, 3 hidden.

| Need | Entry |
|---|---|
| Native Desktop controls | `/cmcp help`; `/cmcp on` joins this conversation; `/cmcp off` leaves it |
| Minimal, one-row or hidden UI | `/cmcp ui minimized`, `/cmcp ui row`, `/cmcp ui hidden`; hiding does not disable CMCP |
| Sources, time and original images | Source list → formal text read → authorized media preview; **READ-ALL** means the complete selected authorized collection, not top-k |
| No-UI project handoff | `cmcp-time project init`, then `project open --config <entry.json>`; explicitly enable the chosen host |
| Explicit follow-up | Choose a formal source, target and optional time in the Pin UI; no time means no automatic reminder |
| Data and lifecycle | `data help`, `desktop help`, `mcp help`, `hermes help`; details include backup/restore and reversible detach |

History, Buffer and Pin have different roles. Buffer defaults to 12 hours (configurable 6–48); expiry or Clear does not delete History or independent Pins. Proactive delivery starts OFF. DND, current source authority, cancellation and deduplication apply; delivery does not mean completion or reading. A conversation joining CMCP cannot silently clear shared OFF/Clean or change saving controls.

**Stored is not necessarily retrievable.** Status separates saved originals, pending/failed registration, formal-read eligibility and cross-host assessment status. Storage metadata alone does not assess receiver handoff; check formal-reading and host receipts separately. Viewing and UI changes do not refresh source times/TTL, create a grant or send a reminder. Missing originals, stale versions and revoked sources fail closed.

Use [backup/restore and update instructions](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-readiness.en.md) before changing an installation. Program, workspace History, host-native history and protected credentials have separate responsibilities. Detaching CMCP preserves originals; it does not erase native host history or implement complete deletion governance. No vectors, audio/video support, cloud synchronization or multi-user concurrent writers are claimed by 0.1.1.

## Documentation and project

[Operating guide](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-readiness.en.md) · [MCP/Hermes and self-hosting](https://github.com/redwakame/CMCP-TIME/blob/main/docs/interop.en.md) · [Commands](https://github.com/redwakame/CMCP-TIME/blob/main/docs/commands.md) · [Configuration](https://github.com/redwakame/CMCP-TIME/blob/main/docs/configuration.md) · [Privacy](https://github.com/redwakame/CMCP-TIME/blob/main/docs/privacy.md) · [Evidence and limits](https://github.com/redwakame/CMCP-TIME/blob/main/docs/verification.md) · [Roadmap](https://github.com/redwakame/CMCP-TIME/blob/main/docs/roadmap.md)

**CMCP-TIME is the current development line.** [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) and [cmcp](https://github.com/redwakame/cmcp) preserve earlier code and policy work, with their own licenses and evidence. No automatic migration or drop-in replacement is implied.

## Documentation and contribution
Ideas, reproducible issues, independent evaluation and collaboration are welcome. Keep private conversations and credentials out of public reports. Read [CONTRIBUTING](https://github.com/redwakame/CMCP-TIME/blob/main/CONTRIBUTING.md), [SECURITY](https://github.com/redwakame/CMCP-TIME/blob/main/SECURITY.md) and the [roadmap](https://github.com/redwakame/CMCP-TIME/blob/main/docs/roadmap.md).

Interested in CMCP-TIME? I’d love to exchange ideas and hear how you’re using it. If you find the project useful, please consider giving it a star on GitHub. I’ll continue improving and updating it, and I also welcome commercial collaboration. Get in touch at [adarobot666@gmail.com](mailto:adarobot666@gmail.com) or [redwakame616@gmail.com](mailto:redwakame616@gmail.com).

## Author and license

Created and maintained by **redwakame**. Current project-authored distribution: [Apache-2.0](https://github.com/redwakame/CMCP-TIME/blob/main/LICENSE), subject to the retained [NOTICE](https://github.com/redwakame/CMCP-TIME/blob/main/NOTICE) and [upstream provenance](https://github.com/redwakame/CMCP-TIME/blob/main/docs/license-provenance-v0.1.md). Earlier permissions are not revoked. The internal compatibility identifier remains `cmcp`; the public name is **CMCP-TIME**.

[CITATION.cff](https://github.com/redwakame/CMCP-TIME/blob/main/CITATION.cff) provides a convenient citation. No additional per-use advertising requirement is added. Public sources contain no personal History, credentials, development transcripts or model weights.

[0.1.1 changes and limits](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-0.1.1.md) · [0.1.0 history](https://github.com/redwakame/CMCP-TIME/blob/main/docs/release-0.1.0.md) · [Reproducible checks](https://github.com/redwakame/CMCP-TIME/blob/main/docs/testing.md)
