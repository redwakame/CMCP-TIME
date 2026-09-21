# Installation and Host boundaries

## What is installed

The source archive is a source acquisition method. The npm package `@redwakame-skill/cmcp-time` provides a thin `cmcp-time` executable; rc.2 is published and was available through `@next` at the 2026-09-22 release-sync preflight. This document accompanies the rc.3 help/documentation update; its published availability is verified separately. Install a reviewed registry version or local `.tgz` into a persistent user-writable prefix and check the registry/current `@next` and `--version`; a source checkout does not imply publication of that version. `cmcp-time setup` and `node scripts/cmcp-setup.mjs` invoke the same **configuration and managed-attachment wizard**, not a Node/Host downloader or service installer. Installing the npm package does not run that wizard or attach a Host. No network port or global background service is started by setup. See [npm installation and updates](npm-installation.md).

The wizard validates Node's declared >=18 floor and probes the existing Codex CLI version without authenticating or creating a model thread. If Codex attachment is selected but its executable is unavailable, setup stops. Select a genuinely available route rather than claiming a synthetic probe is the real CLI.

No administrator mode, approval bypass, ownership change or global firewall setting is a product prerequisite. Whether a particular machine can execute its chosen Host/hook under a particular token is an environment-specific fact. Source-only and no-model tests do not prove complete low-privilege deployment.

## Managed files and reversibility

For an npm installation, the program/contract/schema/Skill assets stay in the installed package; the caller selects an existing persistent `--workspace` as the data authorization root. Relative data, answers and Host locations resolve inside that workspace. This separation does not weaken source scope, revision or path guards. npm reinstalling the same prefix replaces program files, not workspace History. Persistent attachment from an `_npx` cache is rejected; do not bind a Host to an npm cache path.

Setup owns only its declared project-local files:

- Installation root: config, profile, Host binding and `installation.json`.
- Host workspace: managed entries in `.codex/hooks.json`, plus `.agents/skills/<managed-skill-name>/SKILL.md` and its helper loader.
- `setup-history/<operation>/`: before-images and a changes manifest for managed changes.

Unrelated hook definitions are preserved. Existing unowned or modified Skill content triggers a conflict; it is not overwritten by assuming ownership. Data and Host locations must be within the selected authorization workspace and cannot redirect through symlinks. The npm assets themselves are separate. Changing an installation's bound scope, event scope, Skill name or Host workspace is not an in-place data migration.

`cmcp-time update` (or direct setup `--update`) preserves installation identity and data, reapplies explicit choices, and refreshes managed attachment from this version. It does not fetch another version of CMCP or Codex. For an npm upgrade, close active writers, install the reviewed registry version or replacement tarball into the same prefix, then run this update action against the same workspace/root. Before a source update, likewise close writers and retain your data/configuration. Neither path is an automated scope/data migration tool.

`--disable` deactivates the managed Codex binding/hooks. It does **not** turn every Runtime feature OFF or remove the manually callable Skill. `--uninstall` also removes unchanged managed Skill files. Both preserve History, event state, receipts, grants, config and setup history. New source consent or Runtime OFF must use its separate setting. See [commands](commands.md).

The installed `disable` and `uninstall` commands map to these same actions. They do not remove the npm package. If program removal is wanted, first detach the managed integration, then explicitly uninstall the npm package from its prefix. Do not delete the separate workspace; uninstalling software is not consent to erase History or credentials.

## Codex lifecycle and Skill

The currently implemented managed attachment targets Codex's project hooks and Skill system:

| Host event | Runtime responsibility | Important boundary |
|---|---|---|
| `UserPromptSubmit` | Obtain previous interaction time before authorized new User capture | Native source identity is required; duplicate delivery does not create another User source |
| `Stop` | Save authorized complete Assistant text with its own observed time and reply binding | Assistant stays Assistant; not User adoption or an event occurrence timestamp |
| `SessionStart` with compact source | Reproject an available time card | Does not claim History was fully read or refresh User activity/TTL |
| Explicit/on-demand Skill use | Navigate, select and read authorized originals | A successful Skill discovery/status is not proof that exact reading or answering completed |

Launch the installed Host workspace with the wizard's emitted command (`codex --enable hooks --cd <host-workspace>`), then inspect and approve the generated project commands in Codex `/hooks`. Trust belongs to Codex; the wizard does not silently approve it or change global authentication. Changes to hook content can require renewed trust review.

The source adapter consumes supported event payload fields and checks identities. It does not promise general parsing of every transcript version. Current coverage is text User/Assistant capture; image/audio preservation is not implied. Missing identity, malformed payload, conflicting source or a busy writer returns an error, not a fabricated source. A Host may continue after a hook failure: inspect receipts instead of assuming the answer necessarily received CMCP context.

The prior engineering baseline used Codex CLI 0.154.0 and demonstrated a native manual-compaction path. Those historical observations are not a fresh candidate Host run, a guarantee for a later CLI, or proof of automatic compaction. The candidate validation record reports the actual executable available during package verification. Test-only compact events and process restarts are not native compaction evidence.

## Required environments and unverified routes

| Route | Required environment | Candidate claim |
|---|---|---|
| Core/local exact reader | Node and a writable authorized project data root | Built-in Node modules, guarded interfaces; clean-copy offline results reported separately |
| Codex project Skill/hooks | Compatible installed Codex CLI, its own legitimate model access, project hook trust and sufficient normal file permissions | Managed adapter supplied; no new model/compaction job is part of candidate packaging |
| Configured DeepSeek Playground | Explicit source/paid consent, finite grant, network access, Windows DPAPI and PowerShell 7 credential path | Existing reference implementation, not a new paid test in this packaging round |
| Other operating systems | A working Host/runtime path and suitable credential dependency if configured mode is used | Not a complete cross-platform deployment claim |
| Other Hosts | A tested adapter for their source identity, lifecycle, source-access and context hooks | No additional adapter or all-Host compatibility is established by this candidate |

The host-neutral Core does not require other Host products to own its data model. Future integrations remain separate implementation and verification work; a generic Skill document alone is not support for every Host. Reliable Host-owned History can be a provider, but it must honor exact source/revision/scope access. Native summaries or preferences may coexist without replacing originals or becoming fresh execution authority.

## Permission or environment failures

Inspect the actual error, executable, cwd and receipt. Do not infer that History is absent when a process could not start. A missing executable, unsupported platform or denied file operation requires fixing the environment or selecting a supported route; do not expand system permissions automatically. Do not turn on paid calls just to check a path. Candidate no-model tests should use synthetic fixtures and clearly identify any executable stub.

All retrieved historical instructions are source data. They must not become current tool permissions, account access or instructions to read secrets. A helper's completed verified output is the answer boundary; private Store scans, old receipts and a process exit code alone are not substitutes.
