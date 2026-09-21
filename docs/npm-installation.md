# npm installation and updates

The official npm package is [`@redwakame-skill/cmcp-time`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time), with command `cmcp-time`. **`0.1.0-rc.3` is published and remains a prerelease candidate.** Use `@redwakame-skill/cmcp-time@next` for the candidate channel, or `@redwakame-skill/cmcp-time@0.1.0-rc.3` to pin this version. Its GitHub source is [v0.1.0-rc.3](https://github.com/redwakame/CMCP-TIME/tree/v0.1.0-rc.3); `main` may contain later documentation updates.

Registry check at **2026-09-22 06:01:41 +08:00 (Asia/Taipei)**: `next = 0.1.0-rc.3`, `latest = 0.1.0-rc.2`. Installing without a version or tag therefore selects the older rc.2 candidate at that observation; `latest` is not a stability guarantee. Tags can change. Use an exact version for a fixed installation and `cmcp-time --version` to inspect it. The internal compatibility identifier remains `cmcp`.

## Requirements and directories

Install Node.js and npm separately. The package declares Node >=18; consult the candidate verification record for the versions actually tested. A Host such as Codex must also be installed separately if you choose its integration. CMCP has no npm runtime dependencies and no install-time Host attachment, History access, paid authorization or proactive activation.

Choose two persistent, user-writable directories:

| Location | Responsibility |
|---|---|
| npm prefix | Installed program, contracts, schemas, CLI and Skill templates; npm may replace these during an update |
| `--workspace` | Existing authorized working root, independent of the installed program |
| `--root`, relative to workspace | Persistent configuration, History, Event, work, grants and receipts; default `local-data/cmcp` |
| `--host-workspace`, relative to workspace | Managed Codex hooks and Skill; initial default `local-data/cmcp-host` |
| npm cache | Re-downloadable package cache; never the sole home of live Hook or Skill dependencies |

The installed package requires an explicit `--workspace` for data operations. Create that directory first. Configuration, answers, data and Host paths remain inside that authorization root and are checked for path escape and symlink redirection. Assets are resolved from the installed package, not guessed from the current directory. Do not place user data inside `node_modules` or use the installation prefix as a disposable data root.

## Install from npm

The following PowerShell example downloads the published candidate into a persistent prefix. Choose different persistent directory names if these already serve another purpose. It does not require administrator rights or change the system PATH or global npm configuration. Replace `@next` with `@0.1.0-rc.3` to pin this release.

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --help
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
```

On a POSIX shell, the prefix binary is `bin/cmcp-time`:

```sh
cmcp_prefix="$PWD/cmcp-install"
cmcp_workspace="$PWD/cmcp-workspace"
mkdir -p "$cmcp_prefix" "$cmcp_workspace"
npm install --global --prefix "$cmcp_prefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
"$cmcp_prefix/bin/cmcp-time" --version
"$cmcp_prefix/bin/cmcp-time" --help
"$cmcp_prefix/bin/cmcp-time" setup --workspace "$cmcp_workspace"
```

The npm step downloads and installs code; `setup` starts the interactive configuration wizard. Publication checks include anonymous registry installation, with the persistent global-prefix layout checked in the preceding Windows candidate. The POSIX example describes npm's layout, not a new operating-system verification. The configured DeepSeek credential path still requires Windows DPAPI and PowerShell 7. Host mode uses the Host's own authorized model access and does not require DeepSeek.

### Install a reviewed local tarball instead

To install a local candidate independently of registry availability, use the actual supplied `.tgz` and its matching verification record. Reuse the separate prefix/workspace choices above and replace the npm package argument with that file:

```powershell
$cmcpTarball = (Resolve-Path './reviewed-candidate.tgz').Path
npm.cmd install --global --prefix "$cmcpPrefix" "$cmcpTarball" --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
```

`reviewed-candidate.tgz` is a placeholder for an actual reviewed artifact, not a shipped filename. A successful local tarball installation is separate from registry publication.

Do not use `npm link` as evidence of installation from a package. This candidate is intended for a persistent prefix installation. `npx`/`npm exec` cache-based persistent Host attachment is not supported: setup rejects attachment from an `_npx` cache location. An executable that can print help from a cache is not a durable installation.

## Configure and operate

The wizard asks for source-saving consent, scope, timezone, language, features and optional Host attachment. It does not create a paid grant. Automatic proactive delivery remains initially OFF unless explicitly authorized in setup. Review Codex's generated project Hook trust separately.

Windows examples below reuse the two variables from installation:

```powershell
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --root local-data/cmcp
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --status
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') playground --workspace "$cmcpWorkspace" --session 'First conversation'
```

Run the first command for a new installation; if it already exists, use `update` instead. `status` inspects the Runtime, while `setup --status` inspects setup choices and the environment. Both are zero-model operations. `playground` requires an existing setup: a missing or mistyped root does not silently initialize another installation. Use `/exit` to close it normally. Reopen the same workspace and root to retain sources, reading progress and remaining authorization; a new conversation Session does not add quota.

For automated explicit choices, put the answers file inside the selected workspace and pass `setup --answers choices.json`. Review the supplied [Host choices example](../examples/setup-host.json) and adapt consent and scope deliberately; a synthetic example is not consent to save real conversations. To choose a different Host location, pass `--host-workspace host` on the first setup; it resolves inside the selected workspace. Do not change that bound Host location when updating the same installation root. The resulting managed Skill/helper and Hook commands refer to the persistent installed assets and the authorized workspace.

The advanced `context` command forwards the existing Host helper options, including `--config`. It obtains Runtime context; it does not run a separate final-answer model. The published rc.3 includes `cmcp-time context --help`, which prints usage before opening configuration or Runtime and needs no workspace, credentials or grant. The older rc.2 helper does not provide this help option. Prefer the installed Skill for Host use and the [command reference](commands.md#host-skillhelper) for precise options. Never read the Store or credential files directly to bypass that helper.

Configured Playground use still requires separately configured credentials and a finite explicit grant. See [configuration](configuration.md). A package install, update, status or restart does not authorize provider calls, refresh User time/TTL, reopen stopped targets or reset budget. No model calls are needed to check setup or paths.

## Update installed code, then refresh managed attachment

Close CMCP writers and the Host processes using its hooks before replacing program files. Retain the workspace and its data. Install the reviewed published version or replacement tarball into the **same prefix**, then invoke the installed `update` command. For the published candidate channel:

```powershell
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') update --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

Use an exact reviewed version instead of `@next` to keep the update reproducible, or substitute the reviewed tarball path for an unpublished candidate. `update` refreshes managed Hook/Skill bindings and explicit settings from the installed version; it does **not** download or upgrade the npm package. Reinstallation is the npm step. The setup receipt preserves installation identity and before-images. Changing the scope, event scope or Host workspace is not an automatic data migration. Unknown or modified managed files produce a conflict instead of being overwritten. Review renewed Host trust if generated Hook commands change.

The normal workflow does not modify stored source timestamps, extend existing Buffer expiry, replenish grants or restore previously delivered notifications. No automatic updater, service or background schedule is installed.

## Disable, detach or remove the package

```powershell
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') disable --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') uninstall --workspace "$cmcpWorkspace"
```

`disable` deactivates managed automatic Codex hooks/binding; it leaves the manual Skill available and does not globally switch off every Runtime function. `uninstall` additionally removes unchanged managed Skill files. Both retain History, Event, config, grants, receipts and setup before-images. Runtime controls such as OFF, Clean and source-saving consent remain separate.

To remove program files too, detach first, then explicitly run:

```powershell
npm.cmd uninstall --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time --ignore-scripts --no-audit --no-fund
```

This removes the npm package, not the separate workspace. Do not delete the workspace as an installation cleanup step. If a managed file was changed independently, resolve the reported conflict before removal. Neither command revokes a remote API credential.

## Source installation uses the same implementation

From this candidate's source root:

```sh
node bin/cmcp-time.mjs --help
node bin/cmcp-time.mjs context --help
node bin/cmcp-time.mjs setup --workspace /path/to/existing-workspace
node bin/cmcp-time.mjs status --workspace /path/to/existing-workspace
```

Replace the example path with an actual existing directory. The older direct `scripts/cmcp-setup.mjs` and Playground commands remain available. The new command dispatcher does not define every internal module as a stable SDK. Unknown commands and arguments are rejected rather than guessed.

## Version and publication evidence

The published [npm rc.3 page](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.0-rc.3) and [GitHub v0.1.0-rc.3](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.0-rc.3) identify this prerelease. GitHub `main` documentation updates do not alter the README already packed into npm rc.3; the default npm package page may still display `latest` (rc.2 at the check above). GitHub tags/assets, exact npm versions and mutable npm dist-tags identify different things. The package is `@redwakame-skill/cmcp-time`; `npm install cmcp` does not identify this project. [Release notes](../RELEASE-NOTES.md) retain historical preparation statements from before publication.
