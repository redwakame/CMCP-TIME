# Verification and known limits

## What this page claims

The source is a release candidate. Exact source preservation, deterministic Runtime controls, model interpretation, host lifecycle behavior and packaging are different verification layers. A successful request, passing schema or synthetic test does not establish every layer.

[VERIFICATION.json](../VERIFICATION.json) is the unchanged original packaging record. [PUBLICATION-VERIFICATION.json](../PUBLICATION-VERIFICATION.json) records the subsequent presentation/test-portability preparation. Do not merge their environments into a claim that all platforms were tested.

## Original candidate record

The engineering packaging run reported Reading 22/22, Setup 12/12 and dispatch 28/28 on Windows with Node 24.18.0, PowerShell 7.6.6 and Codex CLI 0.154.0, using a non-administrator token. It also checked a real installed setup/helper path without starting a host model. These are original reported evidence, not freshly rerun Windows checks by the publication preparer.

Earlier core engineering supplied bounded source recall, corrected proactive time/source binding, a single real-model continuation example, source-catalog segmentation and resumable multi-process checking. The 77-source multi-process classifier was an explicit substitute, not a new exhaustive live-model classification result. A previously validated Codex manual-compaction path does not prove automatic compaction on every host.

## Subsequent independent observation

The unmodified source candidate was independently tested on Linux/Node 22.16.0: Reading 22/22, Setup 12/12 and dispatch 27/28. The 30ms dispatch case expired before the substitute generator started. No saved or delivered late answer was observed, but the intended “generation started, then timed out” path did not occur, so the case was not a pass.

## Publication preparation: test-only portability adjustment

Only that test case now controls its fixture clock and timer queue. It first waits for the substitute generation to start, asserts that the **30ms** deadline is armed, advances the fixture past that deadline, then releases the late result. It still asserts zero saved answers, zero presentations and no retry of the same progress. Other dispatch cases continue to exercise real Node timers. No Core/Runtime timeout, guard, cancellation or delivery logic changed.

This is a controlled scheduling test, not proof that filesystem validation always finishes inside a real 30ms window. It is not a live-model test.

The final independent run on a new Linux/Node 22.16.0 copy, uid 65534, passed Reading 22/22, Setup 12/12 and dispatch 28/28. System calls used to open/connect network sockets were denied and an actual socket-denial probe was checked. Local socket pairs remained available for Node child-process plumbing; no network or model request was made. Setup/Playground help also succeeded.

Preparation failures were retained outside the public source: the first isolation configuration blocked local socket pairs and prevented child processes; the first controlled test omitted the existing scheduler's 1ms wake-up, so generation did not start. The final run corrected the isolation/test setup without changing the product. Prior failures have not been relabeled as passes.

## Reproduce the supplied checks

From the source directory, with Node available:

```sh
npm run check
npm run test:reading
npm run test:setup
npm run test:dispatch
```

The synthetic suites create unique artifacts below the candidate's ignored local test directory. Run them sequentially. No npm dependency installation, credential or paid model grant is required. Test outputs are local evidence, not public release content. Perform `npm pack --dry-run --json --offline --ignore-scripts` on a clean source copy, not on a tree filled with test data.

## Limits to disclose

The declared Node minimum remains 18, but the full version/platform matrix has not been validated. Current managed host wiring targets Codex. The supplied configured credential route requires Windows DPAPI/PowerShell 7. Other hosts, complete Linux/macOS deployment, automatic-compaction behavior, mobile delivery and complete least-privilege isolation are not established by this packaging work.

The catalog has finite configured segments and metadata costs can grow. Proactive prior-answer context is bounded and requires a formal source relationship. Models can still add assumptions or misinterpret otherwise correct sources. Full History-deletion governance and propagation to every derived layer is not implemented. No universal accuracy, latency, cost reduction or independent security certification is claimed.

Four translated introductions and their diagrams explain the same candidate. Translation coverage is not model-behavior certification. Diagram examples are illustrative, not historical transcripts.
