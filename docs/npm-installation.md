# npm installation, workspace and updates

Install the fixed official registry version **`@redwakame-skill/cmcp-time@0.1.1`**. The earlier [GitHub-only Release v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1), [source tag v0.1.1](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1) and four assets remain unchanged as a distinct distribution. npm 0.1.1 uses the same Runtime, Skill, schemas and dependency graph, with subsequent publication settings and documents. The two tarballs have different hashes and exact source identities; see [channel mapping](#version-and-publication-evidence). A successful installation is not a publication receipt.

## Requirements and directories

Install Node.js >=22.16.0 and npm separately. The latest interoperability increment was tested on Windows Node 24.18.0; earlier Linux/Node 22.16.0 evidence is a separate layer, not proof of every new adapter. Install the selected host separately. npm installs the locked MCP dependencies; source checkouts use `npm ci`. Local mode does not require a running service. Installing does not attach a host, import History, grant model access or enable proactive messages.

Choose two persistent, user-writable directories:

| Location | Responsibility |
|---|---|
| npm prefix | Installed program, contracts, schemas, CLI and Skill templates; npm may replace these during an update |
| `--workspace` | Existing authorized working root, independent of the installed program |
| `--root`, relative to workspace | Persistent configuration, History, Event, work, grants and receipts; default `local-data/cmcp` |
| `--host-workspace`, relative to workspace | Managed Codex hooks and Skill; initial default `local-data/cmcp-host` |
| npm cache | Re-downloadable package cache; never the sole home of live Hook or Skill dependencies |

The installed package requires an explicit `--workspace` for data operations. Create that directory first. Configuration, answers, data and Host paths remain inside that authorization root and are checked for path escape and symlink redirection. Assets are resolved from the installed package, not guessed from the current directory. Do not place user data inside `node_modules` or use the installation prefix as a disposable data root.

## Install the fixed npm version 0.1.1

The fixed-version command is `npm install --prefix ./cmcp-0.1.1 @redwakame-skill/cmcp-time@0.1.1`. The expanded PowerShell example below uses that local prefix, separate from workspace data. Choose different persistent directories if these names already serve another purpose. No administrator rights, global install or system PATH change is required.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-0.1.1'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --help
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
```

On a POSIX shell, the local prefix binary is `node_modules/.bin/cmcp-time`:

```sh
cmcp_prefix="$PWD/cmcp-0.1.1"
cmcp_workspace="$PWD/cmcp-workspace"
mkdir -p "$cmcp_prefix" "$cmcp_workspace"
npm install --prefix "$cmcp_prefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
"$cmcp_prefix/node_modules/.bin/cmcp-time" --version
"$cmcp_prefix/node_modules/.bin/cmcp-time" --help
"$cmcp_prefix/node_modules/.bin/cmcp-time" setup --workspace "$cmcp_workspace"
```

The npm step downloads and installs code; `setup` starts the interactive configuration wizard. The POSIX example describes npm's executable layout; it does not by itself establish a new operating-system verification. See [evidence boundaries](verification.md). The configured DeepSeek credential path still requires Windows DPAPI and PowerShell 7. Host mode uses the Host's own authorized model access and does not require DeepSeek.

### Keep the earlier channels identifiable

The earlier npm 0.1.0 and RC versions remain historical releases. Installing explicit `@0.1.0` selects that older immutable package, not 0.1.1. Use fixed `@0.1.1` for reproducible installation; `latest` and `next` are mutable pointers inspected with `npm view @redwakame-skill/cmcp-time dist-tags --json`.

The original GitHub 0.1.1 tarball remains available when deliberately selecting that channel:

```powershell
$cmcpGitHubRelease = 'https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz'
npm.cmd install --prefix "$cmcpPrefix" "$cmcpGitHubRelease" --no-audit --no-fund
```

Verify that asset with its original Release hashes. It is not the npm 0.1.1 tarball despite sharing a product version; the source ZIP is also a separate source distribution.

### Install a reviewed local tarball instead

To install a reviewed local artifact independently of registry availability, use the actual supplied `.tgz` and its matching verification record. Reuse the separate prefix/workspace choices above and replace the npm package argument with that file:

```powershell
$cmcpTarball = (Resolve-Path './reviewed-package.tgz').Path
npm.cmd install --prefix "$cmcpPrefix" "$cmcpTarball" --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
```

`reviewed-package.tgz` is a placeholder for an actual reviewed artifact, not a shipped filename. A successful local tarball installation is separate from registry publication.

Do not use `npm link` as evidence of installation from a package. This release is intended for a persistent prefix installation. `npx`/`npm exec` cache-based persistent Host attachment is not supported: setup rejects attachment from an `_npx` cache location. An executable that can print help from a cache is not a durable installation.

## Configure and operate

The wizard asks for source-saving consent, scope, timezone, language, features and optional Codex attachment. In 0.1.1, normal interactive setup requires a terminal (TTY) with one answer per question. Batch pipes and empty stdin are rejected before writes; EOF cancels instead of accepting missing answers. Use the explicit `--answers` route below for automation. Declining Codex attachment neither probes nor starts Codex; no Codex installation is required for local/non-Codex use. The compatible binding `state` concerns managed Codex hooks only; `setup --status` separately identifies configuration, host connection, Runtime controls and formal source readability. It does not create a paid grant. Proactive delivery starts OFF and requires separate explicit authorization; no configured inactivity value guarantees a message. Review Codex's generated project Hook trust only when you choose that attachment.

Windows examples below reuse the two variables from installation:

```powershell
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --root local-data/cmcp
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') status --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --status
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') playground --workspace "$cmcpWorkspace" --session 'First conversation'
```

Run the first command for a new installation; if it already exists, use `update` instead. `status` inspects the Runtime, while `setup --status` inspects setup choices and the environment. Both are zero-model operations. `playground` requires an existing setup: a missing or mistyped root does not silently initialize another installation. Use `/exit` to close it normally. Reopen the same workspace and root to retain sources, reading progress and remaining authorization; a new conversation Session does not add quota.

For automated explicit choices, put the reviewed answers file inside the selected workspace. Start with the supplied [Host choices example](../examples/setup-host.json), available at `<prefix>/node_modules/@redwakame-skill/cmcp-time/examples/setup-host.json`, and deliberately adapt consent and scope. Its `attachCodex` is `true`; change it to `false` when using no Codex. The synthetic example is not consent to save real conversations. Then run `cmcp-time setup --workspace <existing-workspace> --answers choices.json`; the answers path is relative to that authorized workspace. To choose a different Host location, pass `--host-workspace host` on the first setup; it resolves inside the selected workspace. Do not change that bound Host location when updating the same installation root. The resulting managed Skill/helper and Hook commands refer to the persistent installed assets and the authorized workspace.

The advanced `context` command forwards the existing Host helper options, including `--config`. It obtains Runtime context; it does not run a separate final-answer model. `cmcp-time context --help` prints usage before opening configuration or Runtime and needs no workspace, credentials or grant. Prefer the installed Skill for Host use and the [command reference](commands.md#host-skillhelper) for precise options. Never read the Store or credential files directly to bypass that helper.

Configured Playground use still requires separately configured credentials and a finite explicit grant. See [configuration](configuration.md). A package install, update, status or restart does not authorize provider calls, refresh User time/TTL, reopen stopped targets or reset budget. No model calls are needed to check setup or paths.

## Update installed code, then refresh managed attachment

Close CMCP writers and the Host processes using its hooks before replacing program files. Retain the workspace and its data. Install the reviewed published version or replacement tarball into the **same prefix**, then invoke the installed `update` command. For a deliberately selected version:

```powershell
npm.cmd install --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.1 --no-audit --no-fund
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') update --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

The fixed npm argument `@redwakame-skill/cmcp-time@0.1.1` selects the registry artifact; use the explicit GitHub URL only when deliberately keeping that older channel identity. Reinstalling the same version is not a newer runtime update. `update` refreshes managed Hook/Skill bindings and explicit settings from the installed version; it does **not** download or upgrade the npm package. Reinstallation is the npm step. The setup receipt preserves installation identity and before-images. Changing the scope, event scope or Host workspace is not an automatic data migration. Unknown or modified managed files produce a conflict instead of being overwritten. Review renewed Host trust if generated Hook commands change.

The normal workflow does not modify stored source timestamps, extend existing Buffer expiry, replenish grants or restore previously delivered notifications. No automatic updater, service or background schedule is installed.

## Disable, detach or remove the package

```powershell
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') disable --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'node_modules/.bin/cmcp-time.cmd') uninstall --workspace "$cmcpWorkspace"
```

`disable` deactivates managed automatic Codex hooks/binding; it leaves the manual Skill available and does not globally switch off every Runtime function. `uninstall` additionally removes unchanged managed Skill files. Both retain History, Event, config, grants, receipts and setup before-images. Runtime controls such as OFF, Clean and source-saving consent remain separate.

To remove program files too, detach first, then explicitly run:

```powershell
npm.cmd uninstall --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time --no-audit --no-fund
```

This removes the npm package, not the separate workspace. Do not delete the workspace as an installation cleanup step. If a managed file was changed independently, resolve the reported conflict before removal. Neither command revokes a remote API credential.

## Source installation uses the same implementation

From a reviewed source root, install the locked dependencies before invoking commands. For the npm channel, use its recorded source commit; the earlier fixed `v0.1.1` tag identifies the original GitHub channel, not the later npm publication settings:

```sh
npm ci
node bin/cmcp-time.mjs --help
node bin/cmcp-time.mjs context --help
node bin/cmcp-time.mjs setup --workspace /path/to/existing-workspace
node bin/cmcp-time.mjs status --workspace /path/to/existing-workspace
```

Replace the example path with an actual existing directory. The older direct `scripts/cmcp-setup.mjs` and Playground commands remain available. The new command dispatcher does not define every internal module as a stable SDK. Unknown commands and arguments are rejected rather than guessed.

## Version and publication evidence

[npm 0.1.1](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.1) and [GitHub v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) are separate artifacts sharing a product version. The immutable GitHub tag/Release retains its original package and source manifest; npm uses a subsequent source commit containing publication settings and documents. `RELEASE-IDENTITY.json` identifies the channel and predecessor; an external release mapping records the exact commit, tarball SHA-256 and registry SHA-512 integrity without a self-hash cycle. If registry `gitHead` is present it must match that npm source commit; absence is not replaced by an invented value. Read the current [source](https://github.com/redwakame/CMCP-TIME/tree/main) and version-specific metadata, not just a version string, to establish identity.

For native Desktop lifecycle, images, Pins, shared projects, backups and optional services, follow the [four-language operating guide](release-readiness.en.md). `setup` handles the existing local/Codex route; it does not silently deploy a Desktop plugin or install Hermes.

The target npm channel is public 0.1.1 with `latest` and `next` pointing to it after release verification; this prepared document does not itself prove publication or current tags. Read back the registry when checking availability:

```sh
npm view @redwakame-skill/cmcp-time@0.1.1 version dist.integrity gitHead --json
npm view @redwakame-skill/cmcp-time dist-tags --json
```

Previously published npm 0.1.0/RCs, the old GitHub tag, Release notes and four assets remain unchanged. [Historical GitHub-only 0.1.1 notes](release-0.1.1.md) describe that earlier channel; their npm status was a snapshot, not a permanent claim about the registry. Installation/update syntax in this guide applies to the npm channel. A source checkout, npm package and GitHub asset are not interchangeable byte identities.
