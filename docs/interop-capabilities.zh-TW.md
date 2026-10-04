# 通用互通能力與證據層級

官方介面查核日期：2026-10-04。這是可用接點與本機驗證的分層；MCP client 連線成功不代表該平台能擷取每輪 User／Assistant 原文，也不代表平台帳戶已開通或通過審核。

| 宿主／平台 | 官方接點 | CMCP 證據與限制 |
| --- | --- | --- |
| Hermes | 官方 MCP、Skills、plugin 的 LLM 前後生命週期；固定 v2026.9.24／套件 0.21.5 | 官方無 UI 生命週期與原生工具已驗；同成品完成 Hermes → 隔離 Harness SDK → 新 Hermes 的文字接續、6 筆 User／Assistant 原文與正式模型材料。非 TUI、Desktop GUI 或全平台；不可把模型重述當原答。 |
| Harness | 官方 Desktop 外掛、生命週期及原生工具；既有 0.2.0-rc.2 | 既有文字、圖片原件、順序交接與控制限定成果保留；本輪服務測試不冒稱 Desktop 新增畫面驗收。 |
| Codex | Skill、MCP、app-server 正式 Thread／Turn／Item 事件 | 既有獨立測試帳戶路線與 driver 已限定驗收；任意 App 對話不會因安裝套件自動加入。 |
| OpenClaw | 官方 MCP client 及訊息／交付 hooks | 官方接點已確認，本輪未啟動 OpenClaw，未宣稱新版完整生命週期或新 MCP adapter 已在該宿主驗通。 |
| dots | 本機 Skills（需已連電腦）、可委派 Codex 任務 | 可評估在明示專案的 Codex 任務使用 CMCP；未接使用者帳戶、未驗主對話透明擷取，不能把委派結果等同主對話原文。 |
| Grok Bot | 官方 Custom MCP 的 Command／Remote HTTPS 模式 | 模式有文件依據；本帳戶可用模式、權限與完整生命週期均待驗。Grok 網頁 connector、Grok Build CLI 與 Grok Bot 分列，不互相代證。 |
| Muse | Connector 申請接受 API／MCP 文件、權限與測試資料 | 本輪未提交、未核准、未上線。API／MCP 可部署成品不等於 Muse 已接受。 |

本次服務範圍是同一使用者、明示專案、單一正式 writer。遠端 TLS／反向代理設定只提供部署責任與設定說明；本機 HTTP 實測不能寫成跨雲實測、資安認證或多人隔離已驗。

## 官方資料與判讀

- [Hermes 官方 repository](https://github.com/NousResearch/hermes-agent)：固定 tag 的原始碼與 plugin 接點優先於模型自我介紹。
- [OpenClaw MCP](https://docs.openclaw.ai/tools/mcp) 與 [訊息 hooks](https://docs.openclaw.ai/plugins/hooks/messages)：提供工具連接與交付事件；本輪只核對文件。
- [OpenAI Skills](https://developers.openai.com/plugins/concepts/skills)：Skill 定義工作流程，MCP 提供資料與受控操作，兩者相輔。
- [dots](https://learn.chatgpt.com/docs/dots) 與 [入門](https://learn.chatgpt.com/docs/dots/getting-started)：本機 Skill 與連線電腦有關；可委派工作但不據此推論原文攔截接點。
- [Grok Bot Team Bots](https://docs.x.ai/grok-bot/team-bots)：Command 與 Remote HTTPS 的執行電腦及憑證責任不同，需核對帳戶。範例不會建立團隊或連接帳戶。
- [Grok 網頁 connectors](https://docs.x.ai/grok/connectors)：另有自訂 MCP；網頁端要求可達 URL，本單未開 tunnel 或公網。
- [Muse Connector guidelines](https://muse.ai/platform/docs)：須說明讀寫／敏感操作、認證、權限、錯誤與限制，另經風險、工具與流程審查；尚未核准。

## 已保存不等於可回查

狀態入口將原件保存、清冊登錄與目前可讀資格分開。`stored` 表示原件已落盤；`pending` 表示登錄待完成；`failed` 保留登錄錯誤及是否仍待處理。正式可回查須同時有目前授權、有效 scope、原件與版本核對。跨宿主還須接收端有效身分與生命週期，不由本機來源數直接推論。

滿容量、缺件、撤權或來源變版須依正式操作處理；查看狀態不能暗中重試、擴容量、刷新時間或派送。
