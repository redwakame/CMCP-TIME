# 單一專案的本機跨宿主交接

此 adapter 以一個短命 Node 程序重用 `CmcpHarnessBridge` 與正式 Core。Harness、Codex 只送原生事件及正式 reader 操作；broker 不含 provider、金鑰或另一個回答模型，也不建立第二份 History。這是同一台 Windows、同一授權專案的順序交接，不是多使用者或跨網路服務。

## 固定設定與啟動

`startSharedProjectServer({config})` 回傳 `{pipe, deadlineAt, close()}`。管理端應在正常收尾 `await close()`；`lifetimeMs` 到期亦自動撤權、取消並關閉。Core 自己釋放所持 writer lock，broker 不刪除或接管未知 lock。請以隱藏視窗啟動管理程序；不要把 credential 檔或 token 加入 log、回覆或證據包。

```js
import {startSharedProjectServer} from './server.mjs';
const server = await startSharedProjectServer({config});
// 完成本次驗證後：await server.close();
```

設定嚴格拒絕未列欄位；所有路徑都是絕對路徑。以下 `<...>` 是管理端應填的值：

```json
{
  "kind": "cmcp_shared_project_config", "version": 1,
  "projectId": "<明確授權的專案>",
  "projectRoot": "C:/<專案根>",
  "runtimeConfig": "C:/<專案根>/runtime.json",
  "traceRoot": "C:/<專案根>/trace",
  "pipe": "\\\\.\\pipe\\cmcp-<本次唯一名稱>",
  "lifetimeMs": 1800000,
  "hosts": {
    "harness": {"workspace": "C:/<專案根>/workspace", "agentId": "<配置的宿主代理身分>", "controlAuthFile": "C:/<專案根>/auth/harness-controller.json", "readAuthFile": "C:/<專案根>/auth/harness-read.json"},
    "codex": {"workspace": "C:/<專案根>/workspace", "agentId": "<配置的宿主代理身分>", "controlAuthFile": "C:/<專案根>/auth/codex-controller.json", "readAuthFile": "C:/<專案根>/auth/codex-read.json"}
  }
}
```

可選 `hostTurnPolicy` 使用 Bridge 既有的 `{timeoutMs,maxTimeoutMs}`。生命週期必須為 1 秒至 12 小時。Runtime 必須是 `providerMode: "host"`，state、receipt、trace 與 credential 均在專案根內，不能經重解析路徑逸出；兩個 workspace 可以不同，但每個請求必須精確等於其配置的 realpath，並不授權其子樹。建議 workspace 與 state、auth、trace 分開。Runtime 設定在本次程序固定；檔案內容改變即拒絕後續操作，重新配置需重新啟動。

每個 credential 檔恰有以下欄位；四個檔名及 token 均不得重複。token 使用管理端產生的 32 bytes 隨機值，不在模型工具參數中暴露。

```json
{"kind":"cmcp_shared_project_credential","version":1,"projectId":"<同設定>","hostId":"harness","role":"controller","token":"<64個小寫hex字元>"}
```

role 僅 `controller` 或 `model_read`。這是 IPC capability 分權，不宣稱能隔離同一 Windows 使用者任意讀檔的惡意程序。部署管理端負責 credential 檔 ACL 與安全保管；client 不輸出 credential，server 的錯誤只傳代碼。

## 呼叫契約

```js
import {callSharedProject} from './client.mjs';
const result = await callSharedProject({
  connection: {pipe, authFile}, role: 'controller',
  request: {projectId, hostId, agentId, workspace, sessionId,
    epoch, requestId, operation, args}
});
```

`sessionId`、`messageId` 是宿主正式原生 ID；agentId 是白名單中配置身分，不能用模型名稱冒充。`requestId` 在同一 Session 內唯一，重送同一 mutation 要保留所有參數與原始 `receivedAt`。`epoch` 是含程序 incarnation 的 opaque 字串，不解析成數字；join/status 可省略，首次 claim 後用 claim 回傳值更新。

| controller operation | args | 主要結果 |
|---|---|---|
| join | `{}` | `joined, sessionId, qualifiedSessionId, epoch`；可預先加入，沒有 owner 就不能寫入 |
| status | `{}` | `owner, epoch, joined, activeTurn, queuedInputs, modelCalls:0`；不附正文 |
| claim | `{}` | `owner, epoch`；共享 OFF/Clean 時拒絕，不替 Session ON 解除共享控制 |
| handoff | `{target:{hostId,agentId,workspace,sessionId}}` | 新 `owner,epoch`；target 已 join、無 running turn 且無 queue 才能成功 |
| revoke | `{}` | 本 Session 同步撤權、owner epoch 失效、reader abort，再等待正式 cancel/release |
| receive | `{messageId,text,receivedAt,revisionId?}` | `{capture,context,origin,epoch}`；Inbox 原文與原時間 |
| claim-turn | `{messageId,revisionId?,harnessTurn?}` | `{capture,context,epoch}`；領取既有 User，不新增正文 |
| request-context | `{}` | Bridge 正式時間 context；不是新的 User 指示 |
| append-assistant | `{messageId,text,receivedAt,revisionId?,userMessageId,userRevisionId?,harnessTurn?}` | 保存單筆可見 Assistant，回合仍執行中 |
| finish | 同 append-assistant | 保存最後可見 Assistant 並結束同一回合 |
| cancel | `{userMessageId,userRevisionId?,harnessTurn?,reason?}` | 正式取消同一票，或丟棄仍排隊的同一 User；不捏造答案 |

`harnessTurn` 是正式整數或 `null`，兩次必須一致。`receivedAt` 是含毫秒的 UTC ISO 字串；宿主缺乏原事件時間時，接線方必須明示首次 hook 觀測時間，不可把重試／回查時間當原提交時間。正文不截斷，容量超出拒絕；這個初版不接受非空 attachments。

model_read role 只有四項操作：`find {}` → `cmcp_find_history`、`open {navigationTicket,selectionJson}` → `cmcp_open_history`、`read {ticket}` → `cmcp_read_history`、`progress {ticket}` → `cmcp_reading_progress`。不得由模型提供 controller role、設定路徑、來源 Pointer 或新 owner。工具必須有 active turn、current owner 與 epoch；navigation/read ticket 也必須屬同一回合。find/open/read 沿正式 reader 記錄工作與進度，不宣稱零狀態變更；status/progress 是零寫入觀測。兩者皆不呼模型。

## 身分、版本與停止邊界

Session 用 project/host/agent/native Session 的完整 tuple 雜湊；message 另加入角色、原生 message ID 與明示 revisionId（預設 r1）。故兩宿主相同本地 ID、User/Assistant 相同 ID、不同版本均不碰撞。Core Pointer 的 revision 仍依既有 r1 契約，宿主版本是 qualified message 的一部分，不改 Core schema。

可驗原映射、正文 hash/bytes、原時間與正式 Pointer/evidenceHash 附加在同一 input journal，且先取得正式 writer lease。它不含正文副本。正式 reader 的已驗 source binding 與 registry 相符時，回傳 `sourceOrigins` 原宿主身分；找不到就明示 `origin_unavailable`，不猜來源。重啟後仍核對版本綁定，但所有 Session/owner grant 從無開始，舊 epoch 不復活。

相同 mutation request 重送回同一回執，參數不同則拒絕。claim/handoff 的同一 request 只在其結果仍是 current owner/epoch 時重播；後續交接或撤權後，舊 request 不能取回權限。正常交接不替使用者取消未完成工作；撤權才立即失效並取消，取消失敗會保持阻塞，須由同一 controller 重試 revoke。這一版本不自動把既有 Pin 的投遞目標改為新宿主，也不啟動 proactive provider。

驗證：在產品根執行 `node --test adapters/shared-project/shared-project.test.mjs`。測試只用獨立合成 state，原件留在明示的 `CMCP_TEST_OUTPUT_ROOT` 測試輸出目錄（見[測試方式](../../docs/testing.md)）；不啟動真實模型，不讀私人 Session。
## 宿主閱讀能力明示

Codex 與 Harness 的既有共用文字 profile 為 `shared-text-v1`，保留 `find`、`open`、`read`、`progress` 四項正式工具。共用 `MODEL_TEXT_PROFILE` 列出已提供工具及未提供的 `reader-status`、`list-images`、`read-image`；Codex read CLI 的 `capabilities` 與 Harness 登錄資訊可讀回此靜態能力，不讀私人資料、不呼叫模型。通用 MCP 傳輸另有完整七項唯讀工具；新增 MCP 不等於既有文字宿主已驗圖片輸入。模型不能藉工具參數升格為 controller，未知操作仍拒絕。
