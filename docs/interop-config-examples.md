# 互通設定範例與責任

範例查核：2026-10-04。以下路徑均為待替換的使用者配置，不會自動建立公開服務、連接帳戶或加入既有對話。正式參數以安裝版本的 `cmcp-time mcp help`、`hermes help` 為準。

## 建立隔離專案與本機服務

```sh
cmcp-time mcp init --root /srv/cmcp/project-a --project project-a --hosts generic,hermes --port 8766 --timezone Asia/Taipei
cmcp-time mcp check --config /srv/cmcp/project-a/mcp-service.json
cmcp-time mcp start --config /srv/cmcp/project-a/mcp-service.json
```

Windows 可把根改為自己選定的新 C 槽資料目錄。`start` 前景保持運行；使用另一個終端機執行 `health`、`capabilities`、`stop`，皆帶相同 `--config`。不需全域 HOME、系統服務或管理員。資料根須持久且可備份；不要指向暫存或無持久卷的容器層。

`private/` 保存本機管理能力、issuer key、短期讀取 binding；`state/` 保存正式資料；宿主工作區與程式另列。目錄權限只能阻擋其他 OS 身分，不能阻擋同一帳戶的任意 Shell。若讓不可信模型自由讀整個服務主目錄，即不符合部署信任邊界。

## 可信宿主與讀取工具分工

可信宿主整合負責 `enable`、正式 `begin`、當次 reader 授權、實際原答保存及結束。`mcp control` 是人類／可信宿主的本機入口，不放進模型 MCP tool 清單。手動呼叫 `begin`／`answer` 是明示來源匯入，不是某平台生命週期已驗的證據。Hermes 使用正式 hook 接線，見其 [README](../adapters/hermes/README.md)。

當正式 User 回合存在且取得 writer 後，管理端可建立該回合的 reader：

```sh
cmcp-time mcp control --config /srv/cmcp/project-a/mcp-service.json --host generic --session native-session-a --operation authorize-reader --subject reader-a
```

結果只提供受保護 `tokenFile`／`bindingFile` 路徑。把 binding 路徑放入下列 client，不能把 controller、issuer key 或 token 值放入提示詞、版本庫或分享包。回合、授權版本或 scope 改變時，舊 binding 不可沿用。

## 通用 stdio client 設定

支援 `mcpServers` 格式的 client 可採：

```json
{
  "mcpServers": {
    "cmcp": {
      "command": "node",
      "args": ["/opt/cmcp/bin/cmcp-time.mjs", "mcp", "start", "--transport", "stdio", "--binding", "/srv/cmcp/project-a/private/REPLACE.binding.json"]
    }
  }
}
```

`/opt/cmcp` 是已安裝套件目錄；不以臨時 `npx` 快取持有正式部署。stdio 只借用已有正式 broker 與當前 reader binding，不建立另一份 History。

Codex 的專案 `config.toml` 格式不同：

```toml
[mcp_servers.cmcp]
command = "node"
args = ["/opt/cmcp/bin/cmcp-time.mjs", "mcp", "start", "--transport", "stdio", "--binding", "/srv/cmcp/project-a/private/REPLACE.binding.json"]
```

此例只連讀取工具，不自動擷取任意 Codex App 對話；完整接續仍用已交付的 [設定式專案入口](../adapters/project-entry/README.md)。[官方 Codex MCP 說明](https://learn.chatgpt.com/docs/extend/mcp) 另列 client 配置，不能與 CMCP 對話授權混為一談。

## HTTP 與自架部署

服務 MCP endpoint 為 `http://127.0.0.1:8766/mcp`；真 client 從受保護 tokenFile 取值加入 Authorization header。不能把原件路徑或任意 URL 當媒體參數；先正式讀取 User 來源，再用該回合 media handle。

遠端方案仍保留 loopback 後端，由受信任 TLS 反向代理轉送。須明示 HTTPS resource audience、issuer／公開驗證 key、Host／Origin allowlist 及 trusted-proxy 設定；代理責任包含 TLS、覆寫轉送標頭及阻擋不可信來源。伺服器只驗事先配置的標準 JWT，不提供 OAuth discovery／動態 client 註冊／瀏覽器登入。需要 OAuth 的平台須另有真實授權伺服器；本單沒有建假 OAuth 或自動上線。

新連線、傳輸 session 與 token 不等於新的 User 對話或保存授權。停止及重啟後重新核對正式回合；有失效票券就重新透過可信宿主流程，不靠手動改 JSON 復活。

## 其他平台

- OpenClaw：依 [官方 MCP 設定](https://docs.openclaw.ai/tools/mcp) 新增 stdio Command 或 Streamable HTTP；先限 CMCP reader tools。仍需另接原文生命週期，不能只看到工具清單就稱完整接續。這是配置範例，本輪未啟動其宿主。
- dots：使用已連電腦上的 Skill，或在明示專案的 Codex 任務使用前述入口；主對話沒有透明擷取證據。本單不修改 dots 帳戶。
- Grok Bot：依 [官方模式](https://docs.x.ai/grok-bot/team-bots) 選 Command 或 Remote HTTPS；先確認帳戶、實際執行電腦與認證格式，不能把本機 URL 當雲端可達。Command 範例沿上列 node／args；Remote HTTPS 另需實際部署，本單未執行。
- Muse：尚在 [文件及審核要求](https://muse.ai/platform/docs) 層級；提交需工具讀寫分類、認證／scope、錯誤、資料責任及專用測試環境。沒有申請回執或審核通過，不宣稱連接器可用。

## 停止、撤權與資料保留

```sh
cmcp-time mcp control --config /srv/cmcp/project-a/mcp-service.json --operation revoke-reader --subject reader-a
cmcp-time mcp stop --config /srv/cmcp/project-a/mcp-service.json
```

取得 `closed` 回執後，才對該資料區執行正式備份。`stopping`、逾時或未知不算已停止；不得刪鎖或強殺其他使用者程序。撤權／停止／解除 client 登錄保留原始 History、媒體與原時間。正式備份還原的命令見 [四語正式操作](release-readiness.zh-TW.md)。
