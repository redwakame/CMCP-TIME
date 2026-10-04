# 官方 Harness SDK 共用專案接點

此插件沿官方 `agent/created`、User inbox、`agent/pre-step`、Assistant commit、`turn/end` 及 Agent dispose 接到 `adapters/shared-project/client.mjs`。它不啟動模型、不建立替代 Session store，不變更模型或一般宿主工具。只有設定明列的 profile、workspace 與 Session 能加入共用專案。

控制端處理加入、owner 取得、User／Assistant 保存、終結及撤權；四個模型工具只使用 `model_read` 憑證。必要 Skill 由官方 `ctx.skills.get()` 取得。User 與 Assistant 逐則保留原 ID、正式事件時間、正文及回覆綁定；不保存 reasoning、stream 或工具正文。不把多則答案拼成一則。

`host.mjs` 的 `validateSharedHarnessConfig()` 是設定入口。`sessionIds` 必須為非空精確白名單；`route` 只驗證使用者指定的正式模型，不做自動切換。`connection` 只含 named pipe 與控制／閱讀憑證檔路徑，憑證值由共用 client 使用，不注入模型。

本接點目前只處理文字。`/cmcp on` 不是 SDK 指令；SDK profile 的明示白名單是本單授權來源。一般 Desktop profile、UI、圖片原件路線、主動工作與 Pin 不由此插件修改。

正常 SDK shutdown 會先排空保存工作，再以控制端 `revoke` 釋放 Session。保存失敗、ID 衝突、原時間缺失或終結失敗都要保留失敗狀態；不能把關閉程序或收到 User admission 當成成功保存。

一般使用入口為套件的 `cmcp-time project init`、`project open --config <entry.json>`；設定只引用使用者既有的官方 Desktop 執行檔、SDK 與認證參照，不依賴工程 logs 或作者原安裝位置。子程序均使用 `windowsHide:true` 及 `ELECTRON_RUN_AS_NODE=1`，不另裝 Runtime。只有使用者選定宿主並提交一般問題，才開始模型工作；查詢狀態與選單不呼叫模型。詳見 [操作指南](../../../docs/release-readiness.zh-TW.md)。

早期 `preflight.mjs` 是歷史施工的生命週期探針，保留於來源，不屬於一般產品入口或待發套件。正式入口使用 `adapters/project-entry/harness-preflight.mjs` 的零模型認證參照核對。
