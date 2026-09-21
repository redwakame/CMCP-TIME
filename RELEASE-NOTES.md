# CMCP-TIME 0.1.0-rc.2 — local npm candidate

This candidate prepares proposed package `@redwakame-skill/cmcp-time` for a later, separately authorized public npm RC using `next`. It is **not yet registry-published**. The public `0.1.0-rc.1` Git commit/tag and assets remain unchanged; the internal compatibility identifier remains `cmcp`.

## Installation-related changes

- Add the thin `cmcp-time` command for help/version, setup/update/disable/uninstall, Runtime status, Playground and Host context. Source and npm entries call the same implementation; this is not a new Runtime or stable SDK for all internal modules.
- Separate installed program assets from an explicit persistent authorization workspace, its data root and managed Host workspace. Keep source, scope, revision and path checks in effect. Reject npx-cache-based persistent attachment.
- Refresh managed Hook/Skill paths through explicit setup/update. npm installation does not attach a Host, read History, authorize paid use or enable proactive delivery. Reinstalling code and updating managed attachment are separate steps; disable/uninstall preserve data.
- Add the [npm installation/update guide](docs/npm-installation.md) and synchronize the four introductions and command documents. Existing product descriptions, diagrams, license and upstream provenance are retained.

The candidate's accompanying report distinguishes actual tarball-install checks, no-model fixtures and remaining registry/account or platform requirements. No new product API or Host model run is implied. A successful local `.tgz` installation does not prove registry publishing permission. No npm publish/staged publish, Git push, tag change or automatic release workflow is part of this preparation.

## Retained rc.1 release notes

The following describes the earlier source candidate and its evidence, not fresh rc.2 model verification.

## CMCP-TIME 0.1.0-rc.1

## Publication preparation

This is the initial public-facing source release candidate. The product name is **CMCP-TIME**, with internal package/plugin compatibility identifiers remaining `cmcp`. The intended repository is [redwakame/CMCP-TIME](https://github.com/redwakame/CMCP-TIME); older repositories are retained as provenance, not overwritten.

The publication revision adds aligned English, Traditional Chinese, Spanish and Japanese introductions; labeled explanatory diagrams; complete navigation; contribution, citation, privacy and security guidance; and current repository metadata. It preserves the 87 Core/Runtime source files and all existing source, time, role, cancellation and delivery semantics. Any test-only portability changes are listed in [verification](docs/verification.md), not presented as new product behavior.

## Included behavior and entries

Per-turn time/source cards, original-text reading, READ outlines, READ-ALL frozen collection paging, bounded ordinary-history checking, Buffer controls, explicit Pins, optional local proactive delivery, source registration/recovery, the setup wizard, Playground and Codex Skill/helper/hook paths.

The wizard is a configuration and project-attachment tool. It does not install Node/hosts, authenticate an account, authorize paid calls or create a background service. Node is required separately; no npm runtime dependencies or model weights are bundled. The supplied configured credential path still depends on Windows DPAPI/PowerShell 7.

## Evidence and limitations

See [the original package-verification record](VERIFICATION.json) and [verification with subsequent observations](docs/verification.md). The original Windows verification and later Linux observations are different evidence sets. Synthetic tests are not live-model accuracy results.

The candidate does not claim all hosts, all operating systems, automated compaction, unlimited capacity, phone delivery, cloud synchronization or complete History deletion. A source can be correct while a model misinterprets it. Automatic delivery needs an active Runtime and channel and is initially OFF.

## Public content

Only the explicit source allowlist is shipped. No personal history, credentials, live grants, development transcripts, private runtime data or old Git history are included. Illustrations are conceptual examples, not real-model screenshots. The package retains Apache-2.0 and existing lawful upstream notices; this revision adds no advertising condition and revokes no earlier license.

A prepared package is not evidence of a remote publication. The publishing operator must report the actual repository, branch/commit and any created prerelease tag separately. No npm publication is implied by this source candidate.
