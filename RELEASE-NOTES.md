# CMCP-TIME 0.1.0-rc.1

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
