# Installation and host boundaries

## Install code, then choose a host

Install the fixed npm package **`@redwakame-skill/cmcp-time@0.1.1`** with `npm install --prefix ./cmcp-0.1.1 @redwakame-skill/cmcp-time@0.1.1`. The earlier [GitHub-only v0.1.1 Release](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) and [fixed tag](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) remain a separate unchanged channel: runtime/contracts are the same, but later npm publication settings/documents produce different bytes and source identity. Use a persistent user-writable prefix and independent persistent workspace. Node >=22.16.0, npm and the chosen host are separate prerequisites. The local prefix binary is `<prefix>/node_modules/.bin/cmcp-time.cmd` on Windows or `<prefix>/node_modules/.bin/cmcp-time` on POSIX. `cmcp-time --version` reads the installed version; package hashes/source mapping also identify its channel. See [installation](npm-installation.md) and the [four-language operating guide](release-readiness.en.md).

`setup` configures the existing local Runtime and optional managed Codex Skill/hooks. It does not download Node, install a host, start a network service or automatically configure Harness Desktop. Optional MCP dependencies are installed by npm; source checkouts use `npm ci`. Hermes has additional [external dependencies](../adapters/hermes/dependencies.md). Local mode remains usable without a running MCP service.

Codex is optional: declining its attachment does not require a Codex installation or startup. Interactive setup requires a TTY and individual answers; for non-interactive use provide explicit `--answers` inside the authorized workspace. Missing input or EOF never implies consent. Setup status keeps the compatible Codex binding fields, but labels their scope and separately reports configuration, host connection, effective Runtime controls, saved originals and formal readability. Uninspected hosts remain unknown rather than being reported as working or stopped.

No administrator mode, approval bypass, global firewall change or model-provider switch is a prerequisite. A failed executable or hook is an environment error, not proof that History is empty. Installing is not authorization to import private conversations, read every account, make paid calls or enable reminders.

## Managed local Codex attachment

The program assets remain in the installed package. An explicit existing `--workspace` is the data authorization root; relative `--root` and `--host-workspace` paths must stay inside it. Persistent attachment from an `_npx` cache is rejected. Setup owns only its declared configuration, `.codex/hooks.json` entries, `.agents/skills/<managed-skill-name>` and setup-history receipts. Unrelated hooks are preserved; unowned or externally modified files cause a conflict.

Review the wizard's emitted launch command and native `/hooks` trust. The adapter uses supported source identities, not a generic parser for every possible transcript:

| Event | Responsibility | Boundary |
|---|---|---|
| UserPromptSubmit | Obtain prior interaction time and capture authorized User input | Native identity required; duplicate events do not become new originals |
| Stop | Capture visible complete Assistant text and reply binding | Assistant is not a User decision; observed message time is not an event-occurrence time |
| SessionStart with compact source | Reproject an available time card | Does not mean all History was read or refresh User time/TTL |
| Explicit Skill use | Navigate, select and formally read authorized originals | Skill discovery or tool registration is not completed reading |

The local hook route and the configured Codex app-server project route are distinct. The latter uses formal Thread/Turn/Item events and a selected existing account/model, as documented in the [project entry](../adapters/project-entry/README.md). It does not transparently attach arbitrary App chats. Native compaction has bounded evidence; process restart or mock events do not establish automatic compaction on every host.

## Native Desktop and optional interoperability

| Route | Required configuration | Evidence boundary |
|---|---|---|
| Official Harness Desktop | Installed 0.2.0-rc.2-compatible host, explicit CMCP deployment/profile registration, per-Session opt-in and saving choices | Native text, JPEG original retrieval, controls and explicit in-app Pin have scoped GUI evidence; later SDK work is separate |
| Harness/Codex project entry | Explicit independent project, existing official executables, configured authorized model route, formal single writer | Sequential text handoff; not automatic import of daily Desktop or all App Threads |
| Hermes | Fixed official v2026.9.24 / 0.21.5 source, isolated Python and pinned requirements; Windows native tools also require Git Bash | Official headless lifecycle and isolated Harness SDK text handoff; no TUI/GUI or all-platform claim |
| MCP | Pinned Node SDK dependencies, persistent configured project and current reader binding | Real stdio/HTTP clients and local persistence; optional transport, not another History or answer generator |
| Configured Playground | Explicit paid/source consent, finite grant, network and Windows DPAPI/PowerShell 7 credential path | Existing DeepSeek reference implementation; not a provider requirement for the Core |
| OpenClaw, dots, Grok Bot, Muse | Platform-specific interfaces, accounts and any required review | See [capability matrix](interop-capabilities.zh-TW.md); documentation is not full lifecycle validation |

Shared text drivers expose their documented text-read profile. MCP's read-tool registration does not imply that every host can accept images or that all conversation lifecycle events are captured. PNG/JPEG original storage, formal media retrieval and model vision are separate claims. Audio/video, vectors, cloud synchronization, multi-user concurrent writers and arbitrary cross-host reminder forwarding are not delivered by 0.1.1. Dots, Muse and Grok Bot expansion remains deferred, not removed from the long-term direction; no new integration is claimed here.

Latest interoperability tests used Windows Node 24.18.0 and Hermes Python 3.12.14. Earlier Linux/Node 22.16.0 results cover their recorded sources and tests; no new full Linux/macOS deployment claim follows. Source-only, schema or synthetic tests do not prove GUI behavior, provider input, model semantics or security certification.

## Update, detach and retain data

Normally stop the selected writer before updating code. Reinstall the reviewed version into the same prefix, then `update --workspace <workspace>` for local setup-managed bindings. `update` does not fetch another npm version. Changing scope or a bound host workspace is not an implicit migration. Preserve the separate data root.

Local `disable` stops managed automatic Codex hooks but leaves manual Skill access; `uninstall` also detaches unchanged managed Skill files. Both preserve History, configuration, grants and receipts. Runtime OFF, Clean and saving consent are separate controls. Native Desktop instead uses its own inspected `desktop disable/unregister/upgrade` operations with fresh hashes; only its owned registration fragment changes. Do not restore an entire stale profile over unrelated settings.

Use [backup/restore](release-readiness.en.md) to preserve original text, media, versions, roles, times and reply bindings. A restore never silently revives Session/model grants or delivery authority. Detaching does not delete History or the host's own chat history; package removal is a separate deliberate operation. Nothing here authorizes erasing user data or credentials.

All instructions found in past sources are data, not current authority. Models receive formal read tools, not human controller capability. Keep official host identity, the source scope and current permissions intact; do not scan private Store or credential files to bypass a failed formal interface.

