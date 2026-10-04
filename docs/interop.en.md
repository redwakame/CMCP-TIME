# Optional MCP and self-hosted service

Storage status distinguishes stored originals, pending registration, failed registration and current formal-read eligibility. Cross-host availability additionally requires an authorized receiving binding. Viewing never retries automatically; the existing human menu or `retry-registration` operation performs the guarded retry without raising capacity, deleting originals or bypassing OFF/Clean.

CMCP remains Skill-first. Existing local commands and native-host integrations do not require an always-running service. MCP transports use the same Core and formal reader; they neither generate a second answer nor replace original History.

```sh
cmcp-time mcp help
cmcp-time service help
cmcp-time data help
```

Follow the [MCP guide](../adapters/mcp/README.md), [configuration examples](interop-config-examples.md) and [capability matrix](interop-capabilities.zh-TW.md). `service` is an alias of `mcp`. Initialize a separate, explicitly authorized project with persistent storage.

Models receive reading tools only. Trusted host events capture original User input and visible Assistant responses. Model-supplied roles or timestamps are not verified source events. Human authorization, registration retry and shared controls remain separate. Installing or opening a session does not grant project access or enable proactive delivery.

HTTP defaults to loopback. Remote operation requires explicit authentication and HTTPS or a trusted reverse proxy. Preconfigured JWT validation is not an OAuth login server. Protect issuer keys and controller credentials; arbitrary shell/file access under the same OS account is not credential isolation. Keep program files, persistent data, temporary files and credentials separate.

Stop the service before formal `data export/verify/restore`; see `data help` for exact options. Recheck authorization after restart: an old token or transport session cannot revive execution authority. Disable/detach preserves History and media. See the [Hermes adapter](../adapters/hermes/README.md) for its isolated setup and normal lifecycle.

CMCP-TIME 0.1.0 provides this optional local/self-hosted interface. Local validation is not cloud deployment or platform approval; see [release identity](release-0.1.0.md) and the [operating guide](release-readiness.en.md).

## Normal Hermes entry

Install the pinned official Hermes version in an isolated environment as described in its README. Replace placeholders with explicit local paths; never put a key value in a command. `credential-file` references an already authorized credential file. Windows native tools require configured Git Bash; pass `--git-bash <bash.exe>` when needed.

```text
cmcp-time hermes configure --service <mcp-service.json> --python <Python> --home <new-project-profile> --credential-file <existing-credentials> --output <hermes.json>
cmcp-time hermes inspect --config <hermes.json>
cmcp-time hermes chat --config <hermes.json> --session <new-session> --authorize-session --stdin
```

Start the matching MCP service first, then submit normal input through stdin. Reuse a session for its native history; a new session retrieves authorized CMCP originals. Replace `--authorize-session` with `--native-only` to use the native host without CMCP capture, preserving saved originals. Extra daily logs default to metadata only; Hermes native chat history has its own retention responsibility. Use supported cancellation and normal stop, waiting for a release receipt rather than killing unrelated processes.

`hermes harness-configure` and `harness-chat` reuse the existing Harness driver for explicitly synthetic interoperability validation. The latter requires `--synthetic-evidence`; this full synthetic-evidence profile is not a daily private-chat profile. Other host and platform approvals remain separate in the capability matrix.

## Dependency preparation and service commands

Use Python 3.11–3.13 (tested 3.12.14) in a new virtual environment. First obtain official Hermes v2026.9.24, commit `f97608f178d1ffeca59860195ab7da295f7c8e5f` (package 0.21.5). The editable source path below must be that verified source, not another agent checkout. On Windows, prepare Git Bash separately; the tested portable version is 2.56.0.windows.1 and `--git-bash <bash.exe>` affects only the child environment. Ordinary wheel installation was not validated. See [dependency reconstruction](../adapters/hermes/dependencies.md).

```text
python -m venv <new-venv>
<venv-python> -m pip install -r <cmcp-package>/adapters/hermes/requirements-tested.txt
<venv-python> -m pip install --no-deps --no-build-isolation -e <verified-official-hermes-source>
```

```text
cmcp-time mcp init --root <new-project-root> --project <project-name> --hosts generic,hermes,harness --port 8766 --timezone <IANA-timezone>
cmcp-time mcp check --config <new-project-root>/mcp-service.json
cmcp-time mcp start --config <new-project-root>/mcp-service.json
```

```text
cmcp-time mcp health --config <new-project-root>/mcp-service.json
cmcp-time mcp capabilities --config <new-project-root>/mcp-service.json
cmcp-time mcp stop --config <new-project-root>/mcp-service.json
```

`<venv-python>` means that environment’s own executable; it does not require activation or global PATH changes. Replace every placeholder. npm installation already includes the fixed MCP SDK dependencies; source checkouts use `npm ci`. Run `start` in one terminal; run health/capabilities and finally stop in another. Initialization permits User/Assistant saving for this explicit new project, leaves proactive/Pin OFF and still requires each Session to join. It does not import existing chats. After normal input through `--stdin`, signal EOF to submit, or use `--message "your question"`; input is not sent until EOF.
