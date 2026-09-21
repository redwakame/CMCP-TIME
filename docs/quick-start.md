# Quick start

The source examples below run from the extracted **candidate root**. `local-data/my-cmcp` and `local-data/my-cmcp-host` are example locations for a new installation, not shipped user data. The `0.1.0-rc.2` npm candidate is not registry-published: first follow [the local tarball installation guide](npm-installation.md), then use the installed `cmcp-time` command with `--workspace <existing-workspace>`. Do not run from inside `node_modules` to store personal data.

## Installed command shortcut

After persistent tarball installation, substitute the actual prefix executable for `cmcp-time` (`<prefix>/cmcp-time.cmd` on Windows or `<prefix>/bin/cmcp-time` on POSIX):

```text
cmcp-time setup --workspace <existing-workspace>
cmcp-time status --workspace <existing-workspace>
cmcp-time playground --workspace <existing-workspace> --session "First conversation"
```

Setup asks for the same explicit choices described below. Data defaults to `local-data/cmcp` within that workspace; program assets stay in the installed package. Source users can run the same dispatcher as `node bin/cmcp-time.mjs`. No npx-cache-based persistent attachment is provided. Setup, status and help do not authorize or invoke a model. Configured chat still needs a finite grant; Host mode uses its own model access.

## Obtain this source candidate

Use `git clone https://github.com/redwakame/CMCP-TIME.git`, `gh repo clone redwakame/CMCP-TIME`, SSH `git@github.com:redwakame/CMCP-TIME.git`, or GitHub Code → Download ZIP. Run the following commands from the resulting source directory. No npm registry release is implied.

## 1. Check prerequisites and choose the source

```powershell
node --version
node scripts/cmcp-setup.mjs --help
node scripts/cmcp-playground.mjs --help
```

Node >=18 is the declared floor. The source has no npm runtime dependencies; `npm install` is not a setup prerequisite. Install Node and your chosen Host separately using their supported distribution. This wizard never installs them. For Codex attachment, check `codex --version` in the same shell and have its normal authentication available. For configured DeepSeek use, the supplied protected credential reader currently requires Windows and PowerShell 7 at its normal installation path.

## 2. Set up without granting paid calls

```powershell
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --host-workspace local-data/my-cmcp-host
```

Confirm your effective IANA timezone and language. Saving User bodies and saving Assistant bodies are separate choices. `host` mode uses the Host's model; choose it when you do not want a configured provider. The default proactive master switch is OFF: answer `no` unless you explicitly want an active local Runtime to evaluate eligible notifications. Pin starts empty. Buffer defaults to 12 hours and accepts 6–48 hours.

Optional person labels are local metadata, not connected contacts. The interactive wizard starts a general-conversation scope. Existing declared event scopes can be supplied through the same structured setup choices; event discovery over every account is not implemented.

The wizard prints the generated configuration and Host location. Its `--answers` option is for explicit structured choices, not for bypassing consent. A synthetic example is not permission to collect personal sources.

## 3A. Use Codex with its own model

If you selected Codex attachment:

```powershell
codex --enable hooks --cd local-data/my-cmcp-host
```

Review this project's generated hooks in Codex `/hooks`; trust is controlled by Codex. Then ask naturally, for example: “Use CMCP to read the discussion about the revised delivery plan.” The Skill uses Runtime navigation and exact reading. No target event ID is required from the user. A true ambiguity remains a clarification.

The installed hooks separately provide before-answer time cards and authorized User/Assistant capture. Skill discovery alone does not guarantee that every turn uses CMCP. Do not run a second writable Playground on the same data root while a Host operation owns its writer.

The local Host candidate/read route needs no DeepSeek calls. Configured selection, batch semantic checking and standalone answers are different operations and still need their appropriate provider authorization. See [READ and READ-ALL](read-operations-v0.1.md).

## 3B. Use the standalone Playground

For this route, choose `configured` mode with explicit paid-path consent, set up the protected credential, then create a finite grant as described in [configuration](configuration.md). The wizard itself creates none.

```powershell
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --status
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --session "First conversation"
```

Inside Playground:

```text
/help
/topics
/topic general
Please help me compare two alternatives for the next project review.
/status
/read What did we discuss about the project review?
/read-all Show the full authorized discussion about the project review.
/next
/reading
/exit
```

Send one source operation and wait for its result before the next. Commands such as status and cancel can remain responsive during a running operation. `/exit` is the supported normal exit; `/quit` is not an alias.

Reopen the same command and root to retain saved data, reading bookmarks and remaining authorization. `/sessions`, `/new <label>` and `/use <number-or-label>` manage conversation labels without adding model quota. Do not create a fresh root or grant merely to hide incomplete work.

## 4. Inspect or change controls

```text
/controls
/buffer
/set bufferRetentionHours 12
/clear
/proactive off
/clean on
/clean off
/off
/on
```

Those settings persist; `/session-set <key> <value>` is temporary. Clear only clears this scope's Buffer, not History, event completion or independent Pins. New purpose-driven reads can reactivate eligible sources but do not automatically reopen follow-up.

## 5. Update, disable or remove managed attachment

Installed equivalent: `cmcp-time update|disable|uninstall --workspace <workspace> --root <existing-root>`, selecting one command, not the literal bar-separated text. Install a reviewed replacement tarball into the same prefix **before** `update`; this command refreshes bindings/settings and does not perform an npm upgrade. See [update and detach details](npm-installation.md#update-installed-code-then-refresh-managed-attachment).

```powershell
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --status
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --update
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --disable
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --uninstall
```

`--update` reapplies explicit choices and the current package's managed hookup; it is not a software downloader. `--disable` disables managed Codex hooks/binding, while manual Skill use and Runtime controls remain separately governed. `--uninstall` additionally removes unchanged managed Skill files. Both preserve your data, config, receipts, grants and setup backups. Modified foreign files are not silently overwritten or deleted.

For every command, persistence rule and recovery path, continue to the [complete command reference](commands.md).
