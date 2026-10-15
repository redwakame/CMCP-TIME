# CMCP-TIME

**保留原話，理解交流之間的時間。**

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**讓 AI 助理依原文與時間接續工作的技能：** 找回原話、圖片、角色及時間，沿用原本的宿主與模型。

**0.1.1 · Apache-2.0 · 原作者：[redwakame](https://github.com/redwakame)**

## 回到真正需要的原件

昨天完成草稿，今天只改其中一項。換到新對話後，CMCP 協助找回原稿與修訂，分清 User 的決定和 Assistant 的提案。圖片修訂保留各自原檔與來源關係，不只留下描述。

![原稿、修訂與跨對話正式回查的用途示意](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/continuity-source-flow.png)

Σ 表示衍生摘要的概念，不表示本版新增摘要功能。

圖解是用途說明，不是真模型回答紀錄。CMCP 提供來源材料，不取代宿主推理或改寫最後答案；模型仍可能誤解已正確取得的原文。

## 從 GitHub 安裝 0.1.1 正式版

正式成品由 [GitHub Release v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) 取得，固定來源為 [tag v0.1.1](https://github.com/redwakame/CMCP-TIME/tree/v0.1.1)。**本次不更新 npm：**registry 保留 [`@redwakame-skill/cmcp-time@0.1.0`](https://www.npmjs.com/package/@redwakame-skill/cmcp-time/v/0.1.0)。只用套件名稱或可變標籤安裝，不會因此升為 0.1.1；以下直接使用固定 GitHub `.tgz` 網址。

先準備 Node.js **22.16.0 以上**與 npm。選兩個持久目錄，分別存程式與獲授權的工作區資料。以下 PowerShell 範例不需要管理員或修改全域 PATH：

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
$cmcpRelease = 'https://github.com/redwakame/CMCP-TIME/releases/download/v0.1.1/redwakame-skill-cmcp-time-0.1.1.tgz'
npm.cmd install --global --prefix "$cmcpPrefix" "$cmcpRelease" --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

精靈處理本機設定與受管理 Codex 接線；官方 Harness Desktop、選配 MCP／Hermes 的步驟另見[正式操作指南](docs/release-readiness.zh-TW.md)。安裝不等於已掛載宿主、匯入私人聊天、授權付費模型或開啟主動派送。不要把永久接線指向短期 `npx` 快取。

[POSIX、本機套件與更新方式](docs/npm-installation.md) · [快速開始](docs/quick-start.md)

**0.1.1 的增量：**分開保留有來源的目前計畫、事實回報、修改範圍與理由。沒有 Codex 也能初始化；正常互動須使用 TTY，自動化採明確 `--answers`。按需狀態保留真正歧義與有界覆蓋，結構 `ready` 不等於語意認證或執行授權。詳見 [0.1.1 更新與限制](docs/release-0.1.1.md)。

## 選擇有對應證據的入口

![同一授權原文庫與選配宿主、MCP 介接](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/host-interoperability.png)

圖示兩組分別成立的順序交接：Codex ↔ Harness、Hermes ↔ Harness，不代表三宿主並行或同一輪三方驗收；虛線 MCP 為共用同一 Core 的選配入口。

| 入口 | 已驗範圍 | 界線 |
|---|---|---|
| 官方 DeepSeek Harness Desktop 0.2.0-rc.2 | 原生文字、圖片原件、新對話回查、控制與明確 Pin 站內跟進 | Desktop 畫面與隔離 SDK 證據分列，不保證全天候或手機通知 |
| Codex | Skill／Hook、官方 app-server 文字交接與限定原生壓縮 | 使用明示專案與帳戶路線；不自動擷取任意 App 對話 |
| Hermes v2026.9.24／0.21.5 | 官方無 UI 生命週期、原生工具、與 Harness SDK 的文字交接 | 另需 Python／Git Bash 相依；已驗 DeepSeek 路線，不是 TUI 或 Desktop GUI 認證 |
| MCP stdio／Streamable HTTP | 真 client、正式閱讀、媒體 handle、範圍／撤權及持久本機服務 | 選配傳輸；本機通過不代表遠端雲端、TLS 部署或平台審核通過 |

OpenClaw、dots、Grok Bot、Muse 的接點與帳戶條件不同，見[能力矩陣](docs/interop-capabilities.zh-TW.md)。最新互通增量實跑 Windows Node 24.18.0；先前 Linux／Node 22.16.0 證據不代表每個新增介接與作業系統已驗。四語文件也不是四語行為認證。

## 日常使用、查證與停止

![最小入口、按需詳細資料，以及分開的對話授權與保存控制](https://raw.githubusercontent.com/redwakame/CMCP-TIME/v0.1.1/docs/assets/controls-modes.png)

概念線框，不是真實 GUI 截圖：1 最小化、2 一般列、3 隱藏。

| 需求 | 操作入口 |
|---|---|
| Desktop 原生控制 | `/cmcp help`；`/cmcp on` 加入目前對話，`/cmcp off` 退出 |
| 最小化、單列或隱藏 | `/cmcp ui minimized`、`/cmcp ui row`、`/cmcp ui hidden`；隱藏不等於停用 |
| 來源、時間與圖片原件 | 來源清冊 → 正式原文閱讀 → 獲授權媒體預覽；**READ-ALL** 是選定授權集合的完整分頁，不是 top-k |
| 無 UI 專案交接 | `cmcp-time project init` 後執行 `project open --config <entry.json>`，再明確啟用所選宿主 |
| 明確跟進 | 在 Pin 介面選正式來源、目標與選配時間；沒設時間就不自動提醒 |
| 資料與生命週期 | `data help`、`desktop help`、`mcp help`、`hermes help`；包含備份還原與可逆解除接線 |

History、Buffer 與 Pin 各司其職。Buffer 預設 12 小時，可設 6–48 小時；到期或 Clear 不刪 History 與獨立 Pin。主動派送首次為 OFF，遵守 DND、目前來源授權、取消及去重；已送出不等於完成或已讀。對話加入不能偷偷解除共用 OFF／Clean 或修改保存設定。

**已保存不等於已可回查。** 狀態分開呈現原件保存、登錄待辦／失敗、正式可讀資格與跨宿主評估狀態。單憑儲存狀態未評估接收端交接，須另查正式閱讀與宿主回執。查看或切換介面不刷新原時間／TTL、不建立授權或派送。缺件、變版或撤權時明確拒絕。

更新前請依[備份還原與更新操作](docs/release-readiness.zh-TW.md)保留資料。程式、工作區 History、宿主原生歷史與受保護憑證責任分開；解除 CMCP 保留原件，不代表清除宿主紀錄或完整刪除治理。0.1.1 不宣稱向量、音訊／影片、雲端同步或多人並行 writer 已交付。

## 文件與專案

[正式操作指南](docs/release-readiness.zh-TW.md) · [MCP／Hermes 與自架](docs/interop.zh-TW.md) · [命令](docs/commands.md) · [設定](docs/configuration.md) · [隱私](docs/privacy.md) · [證據與限制](docs/verification.md) · [後續方向](docs/roadmap.md)

**CMCP-TIME 是目前開發主線。** [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) 與 [cmcp](https://github.com/redwakame/cmcp) 保留早期程式與政策，各自保留授權與驗收身分；不代表可直接替換或自動搬移資料。

## 參與與授權


歡迎提出可重現問題、使用回饋、獨立驗證與合作。請勿把私人聊天、金鑰或完整資料目錄貼到公開 Issue。詳見[貢獻方式](CONTRIBUTING.md)、[安全說明](SECURITY.md)、[隱私與資料](docs/privacy.md)及[後續方向](docs/roadmap.md)。

如果你對 CMCP-TIME 有興趣，歡迎來信交流想法與使用心得。若這個專案對你有幫助，也歡迎在 GitHub 給顆星支持。我會持續優化與更新，並歡迎商業合作洽談。聯絡信箱：[adarobot666@gmail.com](mailto:adarobot666@gmail.com)／[redwakame616@gmail.com](mailto:redwakame616@gmail.com)。

原作者與維護者為 **redwakame**。目前專案發布採 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE) 與[上游授權沿革](docs/license-provenance-v0.1.md)。舊版本已授出的權利不撤銷；內部相容識別仍為 `cmcp`，對外名稱為 **CMCP-TIME**。[CITATION.cff](CITATION.cff) 提供方便引用的資訊，不新增每次使用都必須宣傳作者的條款。

[0.1.1 更新與限制](docs/release-0.1.1.md) · [0.1.0 歷史](docs/release-0.1.0.md) · [可重跑核對](docs/testing.md)
