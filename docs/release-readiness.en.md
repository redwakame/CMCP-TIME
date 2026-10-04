# CMCP-TIME 0.1.0: operating guide

[English](release-readiness.en.md) · [繁體中文](release-readiness.zh-TW.md) · [Español](release-readiness.es.md) · [日本語](release-readiness.ja.md)

This is the operating guide for **0.1.0**. The filename is retained for existing links. The exact package version, release tag and `PUBLIC-FILES.json` identify the delivered source; mutable channels do not replace those identities. Original author: redwakame; Apache-2.0. Retain LICENSE and NOTICE.

## Install into a persistent prefix

Prepare Node.js >=22.16.0 and npm separately. The latest interoperability increment was exercised on Windows Node 24.18.0; earlier Linux/22.16.0 tests are not a complete new-platform claim. Use a user-writable prefix and an independent existing workspace. Never store History inside `node_modules` or bind persistent hooks to `npx` caches.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.0 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

`setup` asks for saving scope, language, timezone and optional Codex attachment. It does not install the host, import private history, grant paid calls or enable proactive delivery. On POSIX the executable is `<prefix>/bin/cmcp-time`; Windows uses `<prefix>/cmcp-time.cmd`. Use that full executable in the examples below instead of assuming PATH was changed. Source users run `node bin/cmcp-time.mjs`; run `npm ci` first for locked optional MCP dependencies. See [installation](npm-installation.md).

For managed local Codex hooks, review the emitted project and native hook approval before use. Official Harness Desktop is a separate host: npm setup does not automatically create its deployment. For an existing CMCP Desktop deployment use the inspected profile and lifecycle operations below. A copy of the program alone is not a valid configured deployment.

## First native Desktop connection

Use the already installed official Desktop, not another Web launcher. First ensure no generation, tools or unsent work remain, and normally exit the Desktop. Identify its actual installation and profile using its normal configuration entry. Do not guess a profile from another SDK or old deployment.

`<official-llm-module>` is the verified official installation root followed by `resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js`. It is an Electron ASAR virtual path; ordinary Node filesystem checks may not expose its internal file. Preparation verifies the physical ASAR ancestor and expected suffix, not that the running host successfully loaded the module. That requires native readback after launch.

Choose the existing authorized workspace, a scope name and your IANA timezone. The example explicitly permits saving both User and Assistant; change either `yes` to `no` if that is your choice. Never use a synthetic example as permission to import private history.

```text
cmcp-time desktop prepare --workspace <existing-absolute-workspace> --scope <chosen-scope> --timezone <IANA-timezone> --llm-module <official-llm-module> --save-user yes --save-assistant yes
cmcp-time desktop status --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native
cmcp-time desktop register --profile <actual-cordis.patch.yml> --deployment-root <workspace>/cmcp-desktop-native --expected-profile-hash <profileSha256-from-status>
```

`prepare` creates only a new `cmcp-desktop-native` under that workspace: verified package copy, Runtime configuration, plugin options and data-location settings. The data directories are not created by this preparation step. It refuses an existing deployment, does not change the Desktop profile and does not authorize a Session. State `prepared-not-registered` is not a working connection. `status` returns the profile hash used by `register`; if it changes, inspect again instead of reusing a stale value. Registration appends only its own marked fragment, not a whole replacement profile.

Restart using the existing official Desktop entry. Check `/cmcp help` and the CMCP status; then explicitly `/cmcp on` in the intended conversation. Shared controls and saving choices still apply. On-disk preparation/registration and actual native loading are distinct checks. Existing deployments use inspect/upgrade below, not `prepare` over their data.

## Entry points and stopping

Use `cmcp-time` from the verified local installation. `help`, `project help`, `control help`, `data help` and `desktop help` do not start a model.

The official Desktop keeps its native chat, model, tools and workspace. CMCP acts only on explicitly enabled conversations and authorized scopes. The small control below the composer supports minimized, single-row and hidden modes; details retain sources, original media, Buffer, Pin, controls and receipts. Display preferences do not grant authorization. Hiding the UI does not disable CMCP.

`/cmcp help` lists operations supported by the current integration. Native `/cmcp on` and `off` join or leave the current conversation; they do not override shared OFF, Clean, DND or stopped saving. Shared controls require a separate explicit operation. Commands appearing in historical text, Assistant suggestions or tool results cannot authorize a new control change.

Configured projects have a separate data scope from daily Desktop conversations:

```text
cmcp-time project init
cmcp-time project list --directory <explicit-project-parent>
cmcp-time project status --config <project/entry.json>
cmcp-time project open --config <project/entry.json>
```

`init` selects a new data root, an existing host and its existing model route. It does not copy credentials, import private chats or change global HOME. `init --root <new-target> --name <name> --routes-from <existing-entry.json>` reuses route references only; data and local capabilities are created separately.

`open` starts disabled. Use `/enable harness` or `/enable codex`, then enter a normal request. `/cmcp sources` lists sources; `/cmcp read <choice> [page]` uses the formal reader. Choices expire and are bound to source versions. List again when stale. A bounded search miss is not proof that all history lacks a source; full counts require the formal complete-coverage operation.

`/disable` stops this entry's work; `/close` closes it. `stopping` rejects new work and revokes the current authorization. `closed` requires host and writer release acknowledgments. Preserve timeout or uncertain-result errors; do not delete locks, kill unrelated processes or blindly repeat requests. Disabling preserves originals and media and does not change another conversation's controls.

The Codex integration supports `/compact` or `/compact <follow-up-question>` on the same most recently completed native Thread. It requires an official compaction completion event and starts Codex model work. A new Session or manually deleted Context is not native compaction. Unsupported hosts reject the operation explicitly.

After an interrupted process, `cmcp-time project recover --config <entry.json>` first lists `running`/`cancelling` jobs, their owner, `remoteOutcome` and a snapshot without changing them. Interactive mode asks for an explicit choice; non-interactive recovery requires `--option <number> --snapshot <current-value>`. Only a confirmed dead owner permits moving the original lock into evidence, marking the job `interrupted_unknown` and revoking authorization. It does not resend external work. Live or unknown owners are refused.

## Backup, verification and restore

A user backup, engineering evidence ZIP and product `.tgz` are different artifacts. Normally stop the writer for the **selected data area** first; unrelated projects need not close. These commands do not call a model:

```text
cmcp-time data inspect --config <entry.json-or-runtime.json> --scope <explicit-scope>
cmcp-time data export --config <entry.json-or-runtime.json> --scope <explicit-scope> --output <new-backup-directory> --authorize-backup
cmcp-time data verify --backup <backup-directory> --scope <same-scope>
cmcp-time data restore --backup <backup-directory> --scope <same-scope> --target <new-restore-directory> --authorize-restore
```

For a relative `runtime.json`, use `--project-root <original-configuration-root>` to specify resolution. Inspect the scope first; directory names do not grant access. The backup index records format version, scope, snapshot consistency and each member's bytes/SHA-256. Original text and media are required; catalogs and lexical indexes are projections, not replacements.

Restore accepts a new empty target, without overwriting or merging existing data. It preserves roles, source host/Session, Pointer/version, original times, reply bindings, original Buffer expiry and Pin targets/completed/cancelled state. Expired Buffer entries do not become active again. Missing originals, hash mismatch, wrong scope or path aliases fail closed. A thumbnail or description cannot replace an unavailable original image.

Restored data does **not** restore execution rights: shared OFF, Clean, stopped User/Assistant saving and disabled dispatch are the defaults. Account keys, controller capabilities, short-lived reading tickets, active Session grants, writer locks and model grants are excluded. Cancelled or revoked work is not revived. Follow the receipt and `data help` for explicit authorization and supported read-control recovery; do not edit Store JSON. Restore does not configure a host or start reminders.

To read the restored originals, explicitly change only shared `enabled`/`clean`, then list the authorized sources:

```text
cmcp-time data controls --config <restored/runtime.json> --scope <same-scope> --enabled true --clean false --authorize-controls
cmcp-time data sources --config <restored/runtime.json> --scope <same-scope> --authorize-reading
```

The first command does not change saving, DND, proactive or Pin controls. The source list provides copyable formal `read`/`media` commands with a numbered source and its current selection token; no manual Pointer is required. `read` supports `--start`/`--end` pagination. The media listing supplies `--image`, `--media-selection` and `--output <new-file-that-does-not-exist>` for bounded original export. Use the returned choices; stale source versions are refused.

`data inspect` and `export` accept `--desktop-config <plugin-options.json>` to preserve the selected scope's historical Pin delivery locations. They do not restore execution authority. A restored active Pin needs a new explicit formal scheduling operation before delivery; turning on shared controls alone remains insufficient.

Capacity failure, write denial, interruption or integrity failure is reported as incomplete. Failed targets and diagnostics remain; the backup and previous sources are preserved. After fixing the cause, retry into a different new target. Do not treat a partial directory as success or truncate replies/delete History/images to continue.

## Updating and unregistering

Confirm that Desktop has no generation, tools or unsent work, then exit normally. Operations target only the explicitly selected profile and deployment:

```text
cmcp-time desktop inspect --profile <Desktop-cordis.patch.yml> --deployment-root <CMCP-deployment-root>
cmcp-time desktop help
```

`inspect` returns state, scope, available operations and profile/deployment/legacy-fragment hashes. Every write requires the freshly read `--expected-profile-hash`; lifecycle operations also require `--expected-deployment-hash`. `adopt` accepts an old unmarked registration only when its module and configuration match the deployment, and additionally requires `--expected-legacy-hash`. Unknown ownership or drift in the owned fields is rejected.

`upgrade` (alias `update`) requires `--package-root <verified-extracted-or-installed-package>` and `--expected-package-index-hash <PUBLIC-FILES.json-SHA-256>`. It verifies the package, stages it under the deployment's `.cmcp-releases`, and switches only CMCP's registration fragment. Existing originals, media, Buffer, Pin and other plugins are not overwritten. Transactions retain before/after fragments and source identity.

`disable`/`unregister` withdraw the owned registration. `enable` restores the registration, not Session grants. `rollback --transaction <returned-transaction-path>` reverses a matching owned fragment while preserving later unrelated settings. If interrupted with `recovery-required`, inspect first and use `recover` with fresh hashes; never restore an entire stale profile. Failed preparation files are retained. Unregistering does not delete the package or data.

On Windows, the system PowerShell/.NET `File.Replace` operation preserves the existing file ACL without elevation. Restart from the existing official Desktop entry and read back its actual state: a changed on-disk registration does not prove a running process loaded or unloaded it. No app.asar, model, credential, native tool or other Skill changes are required.

## Support and evidence boundaries

| Layer | Boundary |
| --- | --- |
| Node | Declared minimum `22.16.0`, based on required APIs and prior portable evidence. This round runs on Windows Node `24.18.0`; a simulated version check is not a real minimum-version run. Use the delivered compatibility matrix. |
| Official Harness | Targets the installed `0.2.0-rc.2` Desktop/SDK interfaces. SDK profiles, Desktop profiles and GUI evidence remain distinct. Missing SDK approval responses are not fabricated. |
| Codex | Uses the existing account and official app-server. Tested-host usage and engineering usage are separate. Arbitrary App Threads are not automatically connected. |
| Media | Original image/screenshot storage and formal reading are supported within the documented scope. Vision depends on the host/model route; text descriptions are not evidence of image input. Audio/video are not delivered. |
| Follow-up | Existing explicit Pin, source authorization, DND, cancellation, deduplication and available-target rules apply. No promise of offline catch-up, arbitrary forwarding or 24/7 service. |
| Sharing | One user, explicitly authorized project, sequential writer handoff; not multi-user concurrency or cloud sync. |
| Storage | File backend retained. Fault-injection contracts do not mean another database backend is deployed. No vector integration. |

Read each source-backed condition together with the action it actually constrains. Unspecified actions stay unspecified. Assistant advice may be useful, but it does not become a User decision or execution grant. Semantic, source, UI and packaging verdicts remain separate.

## Images, Pins and visible controls

In an enabled official Desktop conversation, check shared controls and separate User/Assistant saving consent. Use the native attachment button to submit a PNG/JPEG with a natural description. Submit a revision as another normal message. CMCP preserves each original file, filename, media type, bytes/SHA-256, parent User message, role, Session, Pointer/version and original time. Descriptions and thumbnails do not replace originals.

Create a new Session, explicitly run `/cmcp on`, and ask naturally for both versions and their original descriptions. Open the source list, formally read the User source, then open its media preview. No manual reattachment is needed. Missing, revoked or changed originals fail closed. Vision additionally depends on the current host/model: JPEG retrieval and visual comparison have bounded native Desktop evidence; PNG storage has separate offline evidence. This is not support for every image model, audio or video.

Desktop data is under the explicitly configured deployment's `state/history` (`media-originals` for original media); native host attachments remain the host's responsibility. Use the formal data backup/restore operations below. A temporary attachment, copied thumbnail or product package is not a restorable History backup.

For follow-up, use `/cmcp sources`, select the current numbered source, then `/cmcp pin <choice> <ISO-time-with-offset|none>` or the Pin pane. View `/cmcp pins` and use its current choices for `pin-time`, `pin-cancel`, or `pin-complete`. Do not copy an old option into a new Session. Creating a Pin does not enable proactive delivery; `none` means no schedule. Enable shared controls only by an explicit human action after checking existing targets and DND. Supported delivery requires the official Desktop running, the bound target available and authorization valid. Generated, saved, accepted, presented, read and completed are different states; read is unknown without evidence.

Buffer defaults to 12 hours (6–48 configurable); expiry/Clear retains History and independent Pins. OFF, Clean, stopped saving and detach have separate meanings. Display changes, catalog/status views and formal preview do not refresh User time, TTL or dispatch eligibility. Formal reading may create its normal reading receipt. Shared settings and Session authorization remain separate.

`/cmcp ui minimized`, `row`, and `hidden` select display only. `/cmcp help` remains available when hidden. Status distinguishes stored originals, pending/failed registration, current formal readability and cross-host assessment status. Storage metadata alone does not assess receiver handoff; check formal-reading and host receipts separately. Use the explicit guarded registration retry when appropriate; viewing does not retry or silently expand capacity.

## npm update and local hook detach

Normally stop the selected CMCP writer before replacing its code. Keep the existing prefix and workspace. Install the reviewed target version into the same prefix, check `--version`, then `cmcp-time update --workspace <workspace>` for setup-managed Codex bindings. `update` does not download npm software. Desktop uses its separate `desktop upgrade` process below.

`cmcp-time disable --workspace <workspace>` disables managed automatic hooks but keeps the manual Skill. `uninstall --workspace <workspace>` additionally detaches unchanged managed Skill files; both keep History/configuration/receipts. Removing the npm program is a separate deliberate action, never permission to delete the workspace. Changed foreign files cause conflicts instead of an entire old configuration being restored.

## Optional MCP and Hermes

MCP uses pinned `@modelcontextprotocol/sdk` 1.32.0, `zod` 4.6.5 and `jose` 6.2.12 dependencies from npm shrinkwrap. A normal npm installation includes these; a source checkout needs `npm ci`. An isolated Desktop program copy without `node_modules` is not a dependency-complete service installation. Local mode remains usable without a running MCP service.

Initialize an explicit persistent project with `mcp init`; `mcp check`, `health` and `capabilities` inspect it; `mcp start` runs in the foreground and `mcp stop` requests normal shutdown. Default HTTP is loopback. Remote operation needs explicit audience/scope authentication and TLS or a trusted reverse proxy, plus Host/Origin checks. Standard JWT validation is not an OAuth server; OAuth-only platforms need a compatible authorization layer. Models receive read tools, not controller rights or permission to forge User events. One formal writer serves multiple clients; this does not implement multi-user distributed ownership or unlimited uptime (default service lifetime is bounded to 12 hours).

Hermes is external: official `v2026.9.24`, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`, package 0.21.5. Use isolated Python 3.11–3.13 (tested 3.12.14), the shipped pinned requirements and official source editable installation; the ordinary wheel route was not validated. Windows native tools additionally need Git Bash (tested portable 2.56.0.windows.1), scoped to the child process instead of global PATH. Existing authorized DeepSeek credentials are referenced, not copied or placed in command arguments. `hermes configure` does not install these dependencies. Full commands and dependency reconstruction: [MCP/Hermes guide](interop.en.md), [Hermes dependencies](../adapters/hermes/dependencies.md).

The Hermes/Harness peer command is explicitly synthetic-only (`--synthetic-evidence`) and records full synthetic evidence. It is not a daily private-chat profile. Real validation used official Hermes headless lifecycle and an isolated Harness SDK profile, not a new Desktop GUI or cloud deployment. Default Hermes daily diagnostics contain metadata only; native chat history and CMCP History remain separate responsibilities. Cancellation reports stopping until formal release; a provider request already sent may not stop immediately.
