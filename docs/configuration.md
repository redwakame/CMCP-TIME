# Configuration, controls and authorization

Use [setup](quick-start.md) to create a project-local config. Configuration, data scope, conversation identity, process lifetime and model authorization are separate. A fresh Session or a restart never grants more calls. One root has one normal writer; close its active writer before another entry takes over.

## Data and paths

The selected installation root contains `config.json`, `playground.json`, History/event/journal state, operation receipts, and setup records. `installation.json` identifies managed attachment; `setup-history/` records prior managed files and changes. Those are **user data**, not public source files. Do not add them to a shared source archive.

Use paths inside this extracted project. Runtime derives its project root from module location, not an assumed personal home directory. Generated installed bindings can contain resolved paths to this installation. Moving an already configured installation is not a tested migration mechanism; do not edit original source Pointers or journal identity to make it appear migrated. Initial setup must run after placing the source at its intended location.

The example Runtime JSON is explicitly synthetic and host-mode. Its IANA timezone is an example, not a global user default. Existing `input.loopTiming.ttlMs` is not the current Buffer retention policy; `bufferRetention.hours` controls new normal Buffer activations.

## Persistent and temporary controls

After explicit source authorization, feature defaults are:

| Setting | Default | Scope |
|---|---|---|
| `enabled` | true | Overall augmentation; separate from source saving |
| `clean` | false | Suppress enhancement without deleting existing data |
| `buffer` | true | Buffer activation and Buffer-based eligibility; not History retention |
| `timeIndex` | true | Basic time/source cards and projections; original message times remain in authorized History |
| `historyRecall` | true | Historical candidate/reading access |
| `answerHistory` | true | On-demand original text for normal answers and associated context paths; explicit reader is separately governed |
| `discussionAssociation` | true | New supported discussion relations; original reply identity is retained separately |
| `saveUser`, `saveAssistant` | Explicit setup consent | Separate authorization to retain new message bodies |
| `proactive` | false | Shared automatic Buffer/Pin generation and delivery switch |
| `pins` | true; list empty | Explicit independent Pin operation; no implicit schedule |
| `bufferRetentionHours` | 12 | Future valid activations; accepted range 6–48 hours |
| `doNotDisturb` | disabled | Only explicit timezone/windows; no inferred sleeping schedule |
| `readingLimits` | configured bounded limits | Source count, cumulative bytes, page bytes and projection cap remain distinct |
| `timezone`, `language` | Effective setup timezone; English language | Display/answer preference; no rewriting original instants |

`/set`, `/on`, `/off`, `/clean`, `/proactive`, `/dnd` and `/read-limits` persist through the control journal. `/session-set` changes the current active Runtime value only; it also records revocation identity so restart or OFF→ON cannot revive an old operation. `/controls` shows persisted values, active overrides and effective values. `requiresReopen:true` means exit and reopen before using the new setting.

Feature ON is not permission to bypass source consent or grant limits. A later source-authorization revocation remains stronger than `/set saveUser on`; setup update or the formal `authorizeSources` interface records a new explicit authorization. Saving OFF permits ordinary conversation but does not authorize retaining its body in a diagnostic log. Existing bodies are not erased by changing a saving switch.

Clear, cancellation, expiry, OFF and deletion are different operations. Buffer Clear invalidates old activation/reading generations without deleting History, closing the event or cancelling an independent Pin. New authorized purpose-driven retrieval can reactivate selected history; it does not automatically reopen dialogue follow-up. No general destructive-delete command is introduced in this candidate's interactive command list.

## Source catalog capacity is not model context capacity

New setup uses `sourceCatalog.maxSegments:64`. Each segment uses the existing `input.storageCapacity.maxSources` per-segment resource limit; the normal default of 256 gives a finite 16,384 registered-source capacity. Old configs without `sourceCatalog` retain one segment. `maxSegments` accepts integers 1–1024. This is finite local resource configuration, not an unlimited-history promise.

The first segment retains its location; extra segments contain derived catalog/index entries, not another History truth. Current status exposes registered/unregistered sources, inventory completeness/failures, resource limits and recovery cursor. At capacity, saved source/time-card status and registration status remain separate; an unregistered source must not disappear from status.

To increase **only** the catalog resource on an existing compatible config, set its top-level `sourceCatalog.maxSegments`, then reopen and use `/register` and `/register-next`. The field is designed not to reset its budget binding or create new source authorization. Lowering resources cannot hide already existing segments; incompatible resource status remains visible. Do not change scope, source identity or unrelated bound limits as a shortcut around quota.

Candidate count, catalog navigation bytes, exact original reads, cumulative reading bytes/pages and model request cap have independent limits. A larger persistent catalog does not mean every entry enters the prompt. All-source operations still use bounded enumeration and formal pages/checkpoints.

## Host-only mode

`providerMode:"host"` does not load a configured API credential. Codex owns its model invocation. Local candidates, exact read and Host-shaped reading navigation require no DeepSeek selection/answer request. The installed Skill explains how the Host interprets the returned navigation schema, then Runtime validates source scope and freezes the collection.

This does not make every configured semantic task automatically available through every Host. Standalone Playground answers, current configured batch classification and event processing require their corresponding provider bridge. Model charges from a Host's own service are not counted as zero just because no CMCP provider POST occurs.

## Configured DeepSeek mode

Select `configured` with explicit paid-path consent in setup. This candidate's supplied reference transport uses DeepSeek; the Core remains provider-neutral. There is no automatic Groq fallback. Model/transport defaults are declared in `src/cmcp-guard/cmcp-deepseek-configured-adapter.js` and bounded by `CMCP_RUNTIME_REQUEST_LIMITS` in the bounded provider adapter. Changing model transport is not an instruction to retry a failed logical operation invisibly.

The shipped protected-credential implementation requires **Windows current-user DPAPI** and PowerShell 7. Its Node reader resolves `PowerShell/7/pwsh.exe` under the effective Program Files directory. It is not a generic macOS/Linux credential backend. A different platform must provide and validate an appropriate credential dependency; this candidate does not claim that integration tested.

### Store a new credential without putting it in the command line

Use a private local PowerShell 7 terminal in the candidate root. The following uses a masked prompt and the existing Store helper's private stdin. It creates only the standard project credential reference and a current-user-protected ciphertext in `.cmcp/private/credentials`. Never run the helper's `Read` mode interactively: its plaintext output is intended only for the Runtime's captured pipe.

```powershell
$cmcpRoot = (Get-Location).Path
$cmcpSecret = Read-Host 'DeepSeek API key' -AsSecureString
$cmcpPlain = $null
$cmcpProcess = $null
try {
    $cmcpPlain = ConvertFrom-SecureString -SecureString $cmcpSecret -AsPlainText
    $cmcpStart = [Diagnostics.ProcessStartInfo]::new()
    $cmcpStart.FileName = (Get-Command pwsh).Source
    $cmcpStart.WorkingDirectory = $cmcpRoot
    $cmcpStart.UseShellExecute = $false
    $cmcpStart.CreateNoWindow = $true
    $cmcpStart.RedirectStandardInput = $true
    foreach ($cmcpArg in @('-NoProfile', '-NonInteractive', '-File',
        (Join-Path $cmcpRoot 'scripts/cmcp-protected-credential.ps1'),
        '-Operation', 'Store', '-Provider', 'deepseek', '-ReferencePath',
        (Join-Path $cmcpRoot '.cmcp/deepseek-credential.json'))) {
        $cmcpStart.ArgumentList.Add($cmcpArg)
    }
    $cmcpProcess = [Diagnostics.Process]::Start($cmcpStart)
    $cmcpProcess.StandardInput.Write($cmcpPlain)
    $cmcpProcess.StandardInput.Close()
    $cmcpProcess.WaitForExit()
    if ($cmcpProcess.ExitCode -ne 0) { throw 'Credential storage did not complete.' }
} finally {
    $cmcpPlain = $null
    $cmcpSecret.Dispose()
    if ($cmcpProcess) { $cmcpProcess.Dispose() }
}
```

This does not claim secure erasure of process memory, revoke a cloud key, or test an API. Store rejects an already existing credential/reference; do not delete an existing ciphertext automatically to get past that protection. A key update needs an explicit controlled credential update procedure. The private directory's narrowly scoped current-user protection is part of this helper, not a request to relax project-wide or system ACLs. Protect and exclude both ciphertext and reference from source sharing.

### Grant a finite number of calls

After deliberately choosing a small budget, create a **new unique local authorization ID**. The example below allows up to five provider jobs; failures and timeouts still count. It is an explicit paid-operation authorization, not a prerequisite for status or Host-only reading.

```powershell
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --authorize my-first-five-call-grant --posts 5 --authorized-by "My explicit five-call trial"
```

Do not run this command merely to restart a conversation. Grant IDs, prior consumption and failed attempts are retained. New calls require a new explicit authorization, not reuse of another person's development grant or changing root. Calls do not impose a money cap or prove how many invisible provider-side retries occurred. The reference adapter does not silently switch providers or refund a cancelled remote request.

## Read and projection units

Formal reading-limits files contain all five positive fields:

```json
{"maxSources":64,"maxTotalBytes":65536,"maxPageBytes":1400,"maxPages":80,"maxProjectionBytes":16384}
```

The included [reading-limits example](../examples/reading-limits.json) has this shape. Use it only after confirming these limits for your scope, or place a separately caller-approved limits file under this project for helper use. `/read-limits` changes control-layer caps with the distinct names `maxReadBytes` and `pageBytes`; Runtime intersects them with the formal ticket limits. Neither representation resets a ticket's accumulated use.

Source/projection bytes are UTF-8; offsets are Unicode code points. These measures are not token estimates. An unread range remains unread even when an outline references its source. Normal exact retrieval verifies Pointer, revision, role, scope and content; a frozen reading set does not absorb later sources silently.
