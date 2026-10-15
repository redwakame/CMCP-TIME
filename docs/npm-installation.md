# GitHub package installation, workspace and updates

Install **0.1.1** from the fixed `.tgz` attached to [GitHub Release v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1); source tag [v0.1.1](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1). This release does not publish or retag npm: the registry package remains `@redwakame-skill/cmcp-time@0.1.0`. npm is still the installer for the GitHub tarball and its locked dependencies. Use `cmcp-time --version` to read the installed version; registry names and mutable `latest`/`next` do not identify the GitHub 0.1.1 artifact. [Version notes](release-0.1.1.md) explain the distribution difference. This filename is retained for existing links.

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

## Install 0.1.1 from the GitHub Release asset

The following PowerShell example installs the exact GitHub 0.1.1 asset into a persistent prefix. Choose different persistent directory names if these already serve another purpose. It does not require administrator rights or change the system PATH or global npm configuration. Check the asset identity and checksums on the Release; the GitHub source ZIP is source code, not this npm-format installable `.tgz`.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
$cmcpRelease = 'https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz'
npm.cmd install --global --prefix "$cmcpPrefix" "$cmcpRelease" --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --help
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
```

On a POSIX shell, the prefix binary is `bin/cmcp-time`:

```sh
cmcp_prefix="$PWD/cmcp-install"
cmcp_workspace="$PWD/cmcp-workspace"
mkdir -p "$cmcp_prefix" "$cmcp_workspace"
cmcp_release="https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz"
npm install --global --prefix "$cmcp_prefix" "$cmcp_release" --no-audit --no-fund
"$cmcp_prefix/bin/cmcp-time" --version
"$cmcp_prefix/bin/cmcp-time" --help
"$cmcp_prefix/bin/cmcp-time" setup --workspace "$cmcp_workspace"
```

The npm step downloads and installs code; `setup` starts the interactive configuration wizard. The POSIX example describes npm's executable layout; it does not by itself establish a new operating-system verification. See [evidence boundaries](verification.md). The configured DeepSeek credential path still requires Windows DPAPI and PowerShell 7. Host mode uses the Host's own authorized model access and does not require DeepSeek.

### Retained npm 0.1.0 route

The separately published npm version remains available when you deliberately want the older release:

```powershell
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@0.1.0 --no-audit --no-fund
```

This is **0.1.0**, not a 0.1.1 update. Read its [historical version notes](release-0.1.0.md); the 0.1.1 maintenance fixes described here are not retroactively present in that immutable package. No registry 0.1.1 install or change to `latest`/`next` is part of this release.

### Install a reviewed local tarball instead

To install a reviewed local artifact independently of registry availability, use the actual supplied `.tgz` and its matching verification record. Reuse the separate prefix/workspace choices above and replace the npm package argument with that file:

```powershell
$cmcpTarball = (Resolve-Path './reviewed-package.tgz').Path
npm.cmd install --global --prefix "$cmcpPrefix" "$cmcpTarball" --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
```

`reviewed-package.tgz` is a placeholder for an actual reviewed artifact, not a shipped filename. A successful local tarball installation is separate from registry publication.

Do not use `npm link` as evidence of installation from a package. This release is intended for a persistent prefix installation. `npx`/`npm exec` cache-based persistent Host attachment is not supported: setup rejects attachment from an `_npx` cache location. An executable that can print help from a cache is not a durable installation.

## Configure and operate

The wizard asks for source-saving consent, scope, timezone, language, features and optional Codex attachment. In 0.1.1, normal interactive setup requires a terminal (TTY) with one answer per question. Batch pipes and empty stdin are rejected before writes; EOF cancels instead of accepting missing answers. Use the explicit `--answers` route below for automation. Declining Codex attachment neither probes nor starts Codex; no Codex installation is required for local/non-Codex use. The compatible binding `state` concerns managed Codex hooks only; `setup --status` separately identifies configuration, host connection, Runtime controls and formal source readability. It does not create a paid grant. Proactive delivery starts OFF and requires separate explicit authorization; no configured inactivity value guarantees a message. Review Codex's generated project Hook trust only when you choose that attachment.

Windows examples below reuse the two variables from installation:

```powershell
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --root local-data/cmcp
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --status
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') playground --workspace "$cmcpWorkspace" --session 'First conversation'
```

Run the first command for a new installation; if it already exists, use `update` instead. `status` inspects the Runtime, while `setup --status` inspects setup choices and the environment. Both are zero-model operations. `playground` requires an existing setup: a missing or mistyped root does not silently initialize another installation. Use `/exit` to close it normally. Reopen the same workspace and root to retain sources, reading progress and remaining authorization; a new conversation Session does not add quota.

For automated explicit choices, put the answers file inside the selected workspace and pass `setup --answers choices.json`. Review the supplied [Host choices example](../examples/setup-host.json) and adapt consent and scope deliberately; a synthetic example is not consent to save real conversations. To choose a different Host location, pass `--host-workspace host` on the first setup; it resolves inside the selected workspace. Do not change that bound Host location when updating the same installation root. The resulting managed Skill/helper and Hook commands refer to the persistent installed assets and the authorized workspace.

The advanced `context` command forwards the existing Host helper options, including `--config`. It obtains Runtime context; it does not run a separate final-answer model. `cmcp-time context --help` prints usage before opening configuration or Runtime and needs no workspace, credentials or grant. Prefer the installed Skill for Host use and the [command reference](commands.md#host-skillhelper) for precise options. Never read the Store or credential files directly to bypass that helper.

Configured Playground use still requires separately configured credentials and a finite explicit grant. See [configuration](configuration.md). A package install, update, status or restart does not authorize provider calls, refresh User time/TTL, reopen stopped targets or reset budget. No model calls are needed to check setup or paths.

## Update installed code, then refresh managed attachment

Close CMCP writers and the Host processes using its hooks before replacing program files. Retain the workspace and its data. Install the reviewed published version or replacement tarball into the **same prefix**, then invoke the installed `update` command. For a deliberately selected version:

```powershell
$cmcpRelease = 'https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz'
npm.cmd install --global --prefix "$cmcpPrefix" "$cmcpRelease" --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') update --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

Use this fixed GitHub 0.1.1 asset, or the identical downloaded and verified local tarball, for this update. A registry-name reinstall still selects npm 0.1.0; it does not obtain 0.1.1. Reinstalling the same version is not a newer update. `update` refreshes managed Hook/Skill bindings and explicit settings from the installed version; it does **not** download or upgrade the npm package. Reinstallation is the npm step. The setup receipt preserves installation identity and before-images. Changing the scope, event scope or Host workspace is not an automatic data migration. Unknown or modified managed files produce a conflict instead of being overwritten. Review renewed Host trust if generated Hook commands change.

The normal workflow does not modify stored source timestamps, extend existing Buffer expiry, replenish grants or restore previously delivered notifications. No automatic updater, service or background schedule is installed.

## Disable, detach or remove the package

```powershell
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') disable --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') uninstall --workspace "$cmcpWorkspace"
```

`disable` deactivates managed automatic Codex hooks/binding; it leaves the manual Skill available and does not globally switch off every Runtime function. `uninstall` additionally removes unchanged managed Skill files. Both retain History, Event, config, grants, receipts and setup before-images. Runtime controls such as OFF, Clean and source-saving consent remain separate.

To remove program files too, detach first, then explicitly run:

```powershell
npm.cmd uninstall --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time --no-audit --no-fund
```

This removes the npm package, not the separate workspace. Do not delete the workspace as an installation cleanup step. If a managed file was changed independently, resolve the reported conflict before removal. Neither command revokes a remote API credential.

## Source installation uses the same implementation

From the fixed v0.1.1 source root, install the locked dependencies before invoking commands:

```sh
npm ci
node bin/cmcp-time.mjs --help
node bin/cmcp-time.mjs context --help
node bin/cmcp-time.mjs setup --workspace /path/to/existing-workspace
node bin/cmcp-time.mjs status --workspace /path/to/existing-workspace
```

Replace the example path with an actual existing directory. The older direct `scripts/cmcp-setup.mjs` and Playground commands remain available. The new command dispatcher does not define every internal module as a stable SDK. Unknown commands and arguments are rejected rather than guessed.

## Version and publication evidence

[GitHub v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) identifies this release and its installable `.tgz`; [npm 0.1.0](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.0) remains the separate registry release. README changes on `main` and a GitHub release do not rewrite already published npm packages. Exact versions, tag commits, release assets and mutable dist-tags are separate identities. The package is `@redwakame-skill/cmcp-time`; `npm install cmcp` is another name. Historical records remain historical; see [0.1.1 notes](release-0.1.1.md) and [0.1.0 history](release-0.1.0.md).

For native Desktop lifecycle, images, Pins, shared projects, backups and optional services, follow the [four-language operating guide](release-readiness.en.md). `setup` handles the existing local/Codex route; it does not silently deploy a Desktop plugin or install Hermes.
