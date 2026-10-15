# CMCP MCP 與本機服務

這是既有 CMCP Core／Runtime／正式 reader 的傳輸入口，沒有另一套 History，也不呼叫產品模型。採官方 `@modelcontextprotocol/sdk` 1.32.0、`zod` 4.6.5、`jose` 6.2.12。stdio 與 Streamable HTTP 由同一服務協調單一 writer；套件產品版本與 `PUBLIC-FILES.json` 的 SHA-256 可由 `capabilities` 查核。

MCP 模型工具只有已授權讀取。正常宿主必須用可信生命週期接線送入真正的 User／Assistant 原話、原時間與回覆綁定；安裝一段 MCP client 設定不會自動保存其他軟體的私人聊天。可信接線與人類 CLI 持有 controller；模型 reader 不持有它。Skill、模型回答、自稱 `role=user` 或歷史命令文字都不能建立新保存或控制授權。

## 建立與正常啟停

下列 `<新專案>` 是使用者明確選取的新空目錄，不能指定日常 History 或另一個已安裝專案。初始工作區控制開啟文字保存、主動與 Pin 關閉；每個 Session 仍須明確加入。

```text
cmcp-time mcp init --root <新專案> --project example --hosts generic,hermes --port 8766 --timezone Asia/Taipei
cmcp-time mcp check --config <新專案>/mcp-service.json
cmcp-time mcp start --config <新專案>/mcp-service.json
```

`start` 在目前終端前景執行，不建立 OS 服務、自啟或排程。在第二個終端查看／正常停止：

```text
cmcp-time mcp health --config <新專案>/mcp-service.json
cmcp-time mcp capabilities --config <新專案>/mcp-service.json
cmcp-time mcp stop --config <新專案>/mcp-service.json
```

`service` 是 `mcp` 的 CLI 別名。`check` 驗配置與正式資料範圍；`health` 讀實際服務，不能用配置有效冒充已啟動。`stop` 沿既有 Runtime 取消工作及釋放 writer，保留 History；回報 `stopping` 就仍未取得完整退出回執。Ctrl+C 也走同一正常停止方法。不刪別人鎖檔，不自動搶回死 owner；必要的既有恢復操作另由正式專案控制處理。

服務最長運行 12 小時，設定由正式 shared config 的 `lifetimeMs` 決定；HTTP MCP session 閒置預設 5 分鐘即關閉，最多 32 個。這些是有界服務設定，不是全天候或多人並行保證。

## 人類控制與可信宿主的回合

人類 CLI 的最小合成流程如下。`begin` 的文字必須是真正當次使用者輸入；`answer` 必須是宿主已產生的實際可見原答，不可預填標準答案。

```text
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation enable
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation begin --text "當次真正輸入"
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation authorize-reader --subject my-client
```

`enable` 只加入此 Session 並取得可用 writer，不會解除 Clean、OFF 或其他共用設定。其他 writer 使用中就拒絕。完成正常模型工作後：

```text
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation answer --text "宿主的實際可見原答"
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation disable
```

`begin`／`answer` 支援 `--stdin`，也可明示 `--message-id` 與 ISO `--time`。未指定時採本次可信 CLI 事件的 ID 與可靠系統時間。CLI 在專屬 private 目錄保留回合關聯，不儲存第二份正文。正常宿主接線應使用 `shared-project/client.mjs` 的正式 controller 流程，保留宿主既有 ID／原時間，不將工程時間冒充歷史時間：

`join → claim → receive → claim-turn → request-context／MCP reader → append-assistant／finish`。

`cancel` 取消本回合；`disable` 撤回此 Session；交接使用 `handoff --target-host <host> --target-session <已加入Session>`。控制範例：

```text
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation command --text "status"
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation command --text "set clean on"
cmcp-time mcp control --config <設定> --host generic --session native-session-1 --operation command --text "retry-registration"
```

最後一項是明示人類重新嘗試清冊登錄，仍受有效 scope／generation／OFF／Clean／busy／取消守護；不是模型工具。保存原件與清冊登錄完成分列，請看回傳的 `storageStatus`，不可將 `stored` 一律理解成全部來源可回查。

## stdio client

`authorize-reader` 只在已加入、已取得 writer 且有正式活動回合時成立。它回傳短期 `bindingFile` 與 `tokenFile` 路徑，不在終端列出 token。stdio 設定使用該次回傳的 binding：

```json
{
  "command": "node",
  "args": ["<實際套件>/adapters/mcp/stdio.mjs", "--binding", "<bindingFile>"]
}
```

等價 CLI 是 `cmcp-time mcp start --transport stdio --binding <bindingFile>`。stdio stdout 只輸出 MCP JSON-RPC；主服務需先啟動。binding 綁定專案、host、agent、Session、writer epoch、特定原生回合及授權世代，不提供讓模型更換 Session／scope 的參數。新回合須重新由可信宿主授權，不能沿用前一回合的 token。完成／取消／撤權／服務重啟後舊 binding 不會恢復執行授權。

## Streamable HTTP 與標準 bearer

預設 URL 為 `http://127.0.0.1:8766/mcp`；`/health` 只提供最小服務健康資訊。MCP client 將 `tokenFile` 的內容在記憶體讀入 `Authorization: Bearer …`。不要把 token 放在 URL、對話、報告或命令歷史。

這是預先配置的標準 RS256 JWT bearer，**不是 OAuth 授權伺服器**。不提供 OAuth 登入、動態註冊或自動授權。僅支援 OAuth 自動登入、無法配置既有 bearer 的客戶端，需要其正式認證擴充；不可宣稱所有 MCP client 可直接登入。

服務用 `jose` 核對簽章、固定 issuer、唯一精確 audience、iat／exp／jti、`cmcp:read` 及 grantStamp。subject 映射至目前正式授權，不採模型提供的身分欄位。MCP Session ID 只識別連線，不構成授權。每次 HTTP 請求及工具結果回傳前重新核對；撤權後以同一 subject 再授權，也不復活舊 token。

```text
cmcp-time mcp control --config <設定> --operation revoke-reader --subject my-client
```

HTTP Host 採精確允許清單；Origin 出現時必須明列於 `http.allowedOrigins`。預設不開 CORS 或任意 Origin。直接綁定 `0.0.0.0` 被拒絕。

需要遠端入口時，操作者須另行配置可信 TLS 反向代理，CMCP 仍只監聽 loopback；本單不替使用者建立公網服務。設定 `http.remote: true`、`http.trustedProxy: true`、HTTPS 的 `auth.audience`（路徑 `/mcp`）及精確外部 Host／必要 Origin 清單。代理必須移除客戶端自行提交的轉送標頭，再固定加入 `X-Forwarded-Proto: https`。CMCP 不接受任意 `Forwarded` 標頭，不以轉送欄位判斷身分。這個模式信任同機代理；同一 OS 帳戶能任意執行 shell 時，不能把 loopback、private 檔案或 ACL 宣稱為與代理隔離。實際公網 TLS／代理部署本輪未驗。

## 正式原文與媒體

八個不改原文與控制的工具：`cmcp_status`、`cmcp_find_history`、`cmcp_open_history`、`cmcp_read_history`、`cmcp_reading_progress`、`cmcp_project_continuity`、`cmcp_list_images`、`cmcp_read_image`。導航不是已讀，完整計數仍須正式 READ-ALL；有限未命中不是全歷史不存在。接續投影沿保存設定保留衍生閱讀回執，不能替代原文或建立執行授權；詳見[按需接續契約](../../docs/daily-continuity.md)。

圖片只接受本回合正式 reader 提供的 `mediaSourceRef` 加 `mediaId`。每次驗證父 User 原文、角色、時間、Pointer／版本、evidenceHash、原檔 bytes／SHA-256 與目前控制。不接受任意檔案路徑或 URL。原件缺件、變版、撤權或 hash 不符即拒絕，不用舊描述冒充圖片。查看不刷新 User 原時間、Buffer TTL 或 Pin 資格。

可信 controller 的 `receive.attachments` 可提供最多四個 `{filename,mimeType,dataBase64,sha256?}`，單檔上限 512 KiB，只接受 PNG／JPEG；整個 IPC frame 仍有 1 MiB 上限，四檔並非各 512 KiB 都能一次提交。總量超限在保存正文前拒絕整筆。原件經既有 media store 保存一次，journal／trace 只保留正式引用與雜湊，不再複製 base64；媒體保存失敗與 User 正文保存結果分列。

MCP HTTP／stdio 請求預設 64 KiB，回傳預設 1 MiB；單次媒體回傳仍上限 512 KiB，超限明示拒絕，不裁切成假原件。正式 reader 保留既有有界分頁。MCP 取消通知、中斷連線、服務停止與逾時向 reader 傳遞 AbortSignal；取消後的晚到結果不再當作有效材料。

## 資料與憑證責任

| 位置（均在明示專案內） | 責任 |
| --- | --- |
| `state/history` | 唯一正式文字 History、時間／來源清冊及圖片原件 |
| `state/receipts`、`state/trace` | 既有必要回執／來源與閱讀 metadata，不是第二份正文 |
| `workspaces/<host>` | 各明示宿主的工作區，不掃描私人 Session |
| `runtime.json`、`shared-project.json`、`mcp-service.json` | 固定資料範圍、控制與傳輸設定；不是憑證正文 |
| `private/*-controller.json` | 可信宿主／人類控制能力；不交模型 |
| `private/*-reader.json`、`*.binding.json`、`*.token` | 短期或本機讀取能力，排除分享與備份報告 |
| `private/issuer-private.pem` | 本機簽發者私鑰，不載入 MCP 工具程序、不放證據包 |
| `private/issuer-public.pem`、`read-grants.json` | 固定簽章驗證與目前授權；管理寫入經單一服務序列化 |
| `private/management.json`、`service-state.json`、`turn-*.json` | 本機管理能力、實際啟停回執及回合關聯，無私人正文 |

Windows 初始化會將 private ACL 限目前使用者與 SYSTEM；Unix 採 private mode 0700、檔案 0600。這不能阻止同帳戶任意 shell 讀取，真正不受信工具需由宿主額外沙箱隔離。資料／憑證不要進 npm 包、工程 evidence ZIP 或一般日誌。

停用、撤回與停機不刪 History。服務停止後可沿既有 `cmcp-time data` 正式備份／還原；不要在另一個 writer 工作中直接複製或改 Store。正常退出由 Node 釋放本程序 socket／鎖；不提供永久刪除或清空回收桶的清理捷徑。

## 可重跑核對與限制

測試位於 `adapters/mcp/mcp.test.mjs`，用官方 MCP SDK 的真 stdio 子程序與真 Streamable HTTP client，產品模型呼叫為零。可由外部測試檔設定 `CMCP_PRODUCT_ROOT` 指向實際隔離安裝的套件、`CMCP_TEST_OUTPUT_ROOT` 指向專屬測試目錄。測試只建立合成資料並正常停止；產生的 private 檔案不得放分享包。

本輪實跑平台依主報告與封裝回執列示。Unix socket 路徑需在明示專案內且完整 UTF-8 路徑不超過 100 bytes，Linux 未實跑時不推稱 PASS。Windows named pipe 與 stdio／HTTP 的實測不等於任意 OS、任意宿主生命週期或公網 TLS 已驗。
