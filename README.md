# CMCP-TIME

### Keep the original words. Understand the time between them.

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**A time-aware continuity skill for AI agents.** CMCP helps an existing agent resume an earlier discussion using the right source, original time and current state, without putting the entire conversation history back into every prompt.

**Preview releases · Apache-2.0 · Original author: [redwakame](https://github.com/redwakame)**

## Three everyday reasons to use it

| Your situation | What CMCP adds |
| --- | --- |
| You return tomorrow and ask to change one part of a draft. | Locate the matching original and its version instead of reconstructing it from a vague summary. |
| A conversation resumes after a long gap. | Supply the original interaction times and elapsed time, without inventing what happened while you were away. |
| You pause unfinished work or explicitly pin a follow-up. | Keep recent continuity and Pins separate, with independent controls and automatic delivery OFF by default. |

These are illustrative use cases, not recorded model outputs. Source availability, authorization and the host connection still matter; model interpretation can be wrong.

**Start with the documented Codex route or the standalone Playground.** A host-neutral core is not a claim that every agent already has a working adapter. [Installation](#start-here) · [Commands](docs/commands.md) · [Host boundaries](docs/installation-and-hosts.md).

![Illustrative time-aware continuation, not a recorded model result](docs/assets/timeline.en.png)

## Why it exists

Yesterday's proposal is not today's decision. An answer already delivered is not an unfinished drafting task. A conversation that leaves the context window is not a reason to discard its original words.

CMCP keeps those distinctions available to the agent. It records authorized text sources with roles and times, maintains a source/time catalog, and supplies a bounded amount of relevant context before an answer. When exact wording matters, it goes back to the original source.

It **does not replace the host model's expertise, reasoning, personality or safety policy**, and it is not an answer-rewriting filter. The model can still make mistakes. The purpose is to give it better-grounded continuity, not to promise perfect memory.

## What you can do in this candidate

| Need | CMCP route | Important boundary |
|---|---|---|
| Resume ordinary conversation after a gap | Per-turn time cards and authorized source capture | Requires enabled controls and a working Runtime/host connection |
| Check what was said and when | Time/source catalog, local candidates and exact reading | Original message time is not automatically the time an event happened |
| See the essentials | **READ**: source-supported outline, time and coverage | An outline does not replace the stored original |
| Inspect the full matching discussion | **READ-ALL**: a frozen authorized collection, paged | Not every account, all similar topics or a top-k list called “all” |
| Check or count ordinary past reports | Bounded batch lookup/count with resumable coverage | A mention, a plan and an actual User report are different |
| Keep recent unfinished work available | **Buffer**, default 12 hours, configurable 6–48 | Expiry/Clear does not delete History or independent Pins |
| Pin a specific follow-up | **Pin**, explicit target and optional chosen time | No time means no automatic reminder; delivery is not completion |
| Control intervention | Separate saving, recall, time, Buffer, Pin, Clean, OFF and DND controls | Automatic delivery is **OFF by default** |

No vector database or embedding-model download is required by this candidate. Local lookup and model-assisted semantic interpretation already exist; this is not a claim of exhaustive semantic recall.

## How the pieces fit

![CMCP data, time, bounded context and optional delivery](docs/assets/architecture.en.png)

**History** preserves authorized source text. The **time/source catalog** locates it. **Buffer** represents recent eligible continuity, while **Pins** represent explicitly chosen targets. These are different responsibilities, not four copies of the same conversation.

The catalog is independent of expiring Buffer entries and can be accessed from the continuity workflow. Ordinary conversation can remain outside Buffer and still be found later. Only the material needed now goes to the model. User decisions, Assistant proposals and unknown event times stay distinguishable.

<a id="start-here"></a>
## Start here

**Official npm package:** [`@redwakame-skill/cmcp-time`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time). **Command:** `cmcp-time`. **Source repository:** `redwakame/CMCP-TIME`.

The npm release `0.1.0-rc.2` has been published. A GitHub source release, an npm version and a mutable dist-tag are different identifiers. Use `@next` for the candidate channel, or `@0.1.0-rc.2` to reproduce that published baseline. A tag named `latest` is not a stability certification; the rc.2 publication check found both `next` and `latest` pointing to rc.2.

**This document accompanies `0.1.0-rc.3`**, with `context --help` and documentation updates. At preparation, the release-sync preflight on 2026-09-22 (Asia/Taipei) found the verified published baseline rc.2 at both `next` and `latest`. Publication availability is checked separately: consult the registry/current `@next` and your installed `--version` before relying on rc.3 help. See [release notes](RELEASE-NOTES.md) for the distinction.

### Install, then run the wizard

Windows PowerShell example, from a directory where you want to keep the installation and its separate workspace. Use a new or deliberately selected location. Administrator rights and a system PATH change are not required.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

The npm command downloads the package; the setup command starts the interactive wizard. Choose saving scope, timezone, language and optional features. **Installing does not grant access to private conversations, authorize paid model calls or enable proactive messages.**

The publication check installed the package anonymously from the registry. The persistent global-prefix layout above was verified in the preceding same-content Windows candidate checks. These records are not a full cross-platform test matrix. See the [npm installation guide](docs/npm-installation.md).

**Codex:** choose host mode and review the generated project-local Skill/Hook integration in Codex. This route uses the host model and does not require a separate DeepSeek key. **Playground:** configured-provider mode requires an explicitly configured provider, protected credentials and a finite call budget. Its supplied credential route still depends on Windows DPAPI and PowerShell 7; DeepSeek is the implemented reference route, not the definition of the core.

### Update or stop without deleting history

Keep the installation prefix and workspace separate. After an approved package update at the same prefix, run `cmcp-time update --workspace <your-workspace>` to refresh managed integration paths. `update` does not download a new npm version. `disable` stops managed hooks; `uninstall` detaches managed integration. Neither is a command to delete the separate History workspace. Do not bind persistent hooks to an ephemeral `npx` cache. See [commands](docs/commands.md) and [configuration](docs/configuration.md).

### Prefer a source checkout?

```sh
git clone https://github.com/redwakame/CMCP-TIME.git
cd CMCP-TIME
```

GitHub CLI: `gh repo clone redwakame/CMCP-TIME`. SSH: `git clone git@github.com:redwakame/CMCP-TIME.git`. GitHub **Code → Download ZIP** is also available. Use the [release tags](https://github.com/redwakame/CMCP-TIME/releases) for fixed snapshots; `main` may contain later documentation. Do not assume the unrelated command `npm install cmcp` installs this project.

From a source checkout:

```sh
node scripts/cmcp-setup.mjs --help
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --host-workspace local-data/my-cmcp-host
```

Install Node.js separately. The declared minimum is Node 18; the npm installation checks used Windows with Node 24.18.0, npm 11.16.0 and PowerShell 7.6.6. The existing Codex integration evidence uses CLI 0.154.0. These are versioned observations, not a guarantee for all versions. The wizard does not install Node or an agent. No npm runtime dependencies or embedding-model weights are required by this candidate.

## The controls are part of the product

These commands belong to **CMCP Playground**, not every host's native command parser:

```text
/controls
/read What did we discuss about the delivery plan yesterday?
/read-all Show the full matching delivery-plan discussion.
/next
/set bufferRetentionHours 24
/proactive off
/pins
/clean on
```

Pin an event using the actual number returned by `/topics`, or use `/pin-source` with a registered source. `/pin-time`, `/pin-complete` and `/pin-cancel` manage its lifecycle. Command parameters and examples are in the [complete command reference](docs/commands.md); do not guess internal IDs.

Automatic follow-up requires a running Runtime and delivery channel. Eligible Buffer work and explicitly timed Pins share the master switch, DND, source checks and deduplication. Console presentation is not a phone notification, proof of reading or an always-on service.

## What has and has not been demonstrated

This is a **usable engineering release candidate**, not a blanket production-readiness guarantee. The accompanying records distinguish program controls, exact source reading, model semantics and host integration. See [verification and known limits](docs/verification.md).

The reviewed baseline includes bounded recall, per-turn time cards, separate controls, local Buffer/Pin delivery and a tested Codex hook/manual-compaction path. Candidate packaging also received real Windows setup/helper checks under a non-administrator token. Local fixture tests are not fresh live-model evidence.

**Not claimed:** all hosts, all operating systems, automatic-compaction reliability, unlimited history/index capacity, flawless model interpretation, cloud synchronization, mobile delivery, or complete History-deletion governance. Claude Code, OpenClaw, Hermes, DeepSeek Harness and Grok Bot remain adaptation targets, not an all-green compatibility list. Four-language documentation is not four-language behavioral certification.

## Which repository should I use?

**CMCP-TIME is the current development line.** [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) preserves the earlier OpenClaw-specific skill, while [cmcp](https://github.com/redwakame/cmcp) preserves the earlier policy contract and review artifact. Their historical code, licenses and verification claims remain separate. CMCP-TIME is not advertised as a drop-in replacement for the older OpenClaw skill, and no automatic data migration is implied.

## Documentation and contribution

[Quick start](docs/quick-start.md) · [All commands](docs/commands.md) · [Configuration](docs/configuration.md) · [Hosts & installation](docs/installation-and-hosts.md) · [Design](docs/design.md) · [Privacy](docs/privacy.md) · [Verification](docs/verification.md)

Ideas, reproducible issues, independent evaluation and collaboration are welcome. Keep private conversations and credentials out of public reports. Read [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md) and the [roadmap](docs/roadmap.md).

## Author and license

Created and maintained by **redwakame**. Current project-authored distribution: [Apache-2.0](LICENSE), subject to the retained [NOTICE](NOTICE) and [upstream provenance](docs/license-provenance-v0.1.md). Earlier permissions are not revoked. The internal compatibility identifier remains `cmcp`; the public name is **CMCP-TIME**.

[CITATION.cff](CITATION.cff) provides a convenient citation. No additional per-use advertising requirement is added. Public sources contain no personal History, credentials, development transcripts or model weights.
