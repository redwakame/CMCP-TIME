# Quick start: CMCP-TIME 0.1.1

[English operating guide](release-readiness.en.md) · [繁體中文](release-readiness.zh-TW.md) · [Español](release-readiness.es.md) · [日本語](release-readiness.ja.md)

## 1. Install once, keep data separate

Use [the installation guide](npm-installation.md) to install the **0.1.1 GitHub Release `.tgz`** into a persistent prefix. This release does not update npm: its registry package remains at 0.1.0, so a registry-name install does not provide 0.1.1. Keep an independent existing workspace for authorized data; do not store it in `node_modules` or an `npx` cache. Node >=22.16.0, npm and the chosen host must be installed separately.

Use `<prefix>/cmcp-time.cmd` on Windows or `<prefix>/bin/cmcp-time` on POSIX wherever the following examples say `cmcp-time`:

```text
cmcp-time --version
cmcp-time help
cmcp-time setup --workspace <existing-workspace>
cmcp-time status --workspace <existing-workspace>
```

The wizard asks for scope, timezone, language, separate User/Assistant saving and optional local Codex hooks. Help/status do not call a model. Setup does not grant paid calls, turn on proactive delivery, download a host or automatically create a Harness Desktop deployment.

For normal interactive setup, answer each question in a terminal (TTY). Piped answer batches and empty stdin are rejected before configuration writes; EOF cancels rather than accepting missing answers. Automation can use `setup --workspace <existing-workspace> --answers <answers.json-inside-workspace>` with reviewed explicit choices. Choose no Codex attachment when not using Codex; Codex does not need to be installed or started. `setup --status` distinguishes configuration, managed Codex binding, Runtime controls and source-read eligibility; a disabled Codex binding is not a globally disabled CMCP.

## 2. Choose the actual host entry

| Entry | Next action | Stop |
|---|---|---|
| Local Codex Skill/hooks | Review the wizard's generated project-local hooks with the installed Codex; use its own authorized account/model | `disable --workspace <workspace>` disables managed automatic hooks; manual Skill and Runtime controls remain separate |
| Configured Playground | `playground --workspace <workspace> --session "My conversation"`; separately configure credentials and an explicit grant first | `/exit` |
| Official Harness Desktop | Follow [Desktop preparation and lifecycle](release-readiness.en.md), then use native `/cmcp help` and explicitly join each Session | `/cmcp off` leaves that Session; shared controls and unregister are separate |
| Configured Harness/Codex project | `project init`, `project open --config <entry.json>`, then `/enable harness` or `/enable codex` | `/disable`, `/close`; wait for host/writer release |
| Optional MCP/Hermes | Follow [interoperability setup](interop.en.md); persistent project, real dependencies and explicit authorization | `mcp stop`; Hermes waits for its formal release |

Independent project data does not automatically include daily Desktop conversations or arbitrary Codex App Threads. Use only the intended scope. Source/history instructions and Assistant suggestions cannot authorize new control operations.

## 3. Ask naturally, then inspect the source

Submit ordinary User input and let the native host answer. In a new explicitly authorized Session, ask for the relevant original or revision. Use source choices and formal reading; a selected candidate is not already-read text. READ-ALL covers the complete selected authorized collection, not all accounts or a top-k list. Image previews require their original, current version and formal permission.

For current plans, revisions, reports and reasons, ask naturally to organize the current state. The host uses formal source-bound tools; no manual source IDs or JSON are needed. Genuine ambiguity, missing originals and incomplete reading remain visible as `partial`. Complete projection pages do not prove every selected original reached the model, and a structurally valid `ready` is neither semantic certification nor permission to act. See [0.1.1 changes and bounded evidence](release-0.1.1.md).

`/cmcp help` describes the current host's supported controls; it is not the Playground command parser. Display modes `minimized`, `row`, `hidden` affect only presentation. Buffer expiry/Clear keeps History and independent Pins. Pin needs an explicit source/target; no time means no automatic reminder. Proactive delivery initially stays OFF.

## 4. Preserve data when updating or stopping

Before a code update, normally stop its writer and use `data help` for scope-bound export/verify/restore. Reinstall the reviewed version into the same prefix, then refresh local managed hooks with `update --workspace <workspace>`. Desktop uses its separate verified `desktop upgrade` path. Neither action migrates private scopes or erases History.

`uninstall --workspace <workspace>` detaches managed local integration; it does not remove the installed program or authorize deleting workspace data. See [all operations and limits](release-readiness.en.md), [commands](commands.md), [host boundaries](installation-and-hosts.md), [privacy](privacy.md) and [release notes](release-0.1.1.md).
