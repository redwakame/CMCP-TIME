# CMCP-TIME

### 原話留得住，時間接得上。

[English](README.md) · [繁體中文](README.zh-TW.md) · [Español](README.es.md) · [日本語](README.ja.md)

**為既有 AI 智能體補上時間接續能力的技能。** CMCP 協助模型帶著正確的來源、原時間與當前狀態接續討論，不必每輪重新塞入整段歷史。

**候選版本 `0.1.0-rc.1` · Apache-2.0 · 原作者：[redwakame](https://github.com/redwakame)**

![時間接續情境示意，非模型實測截圖](docs/assets/timeline.zh-TW.png)

## 為什麼做 CMCP？

昨天提出的方案，不等於今天已經決定。已經交付的草稿，不該再次被當成還沒開始的工作。對話離開模型的上下文，也不應讓原話失去日後查找的機會。

CMCP 保留獲授權的對話原文、角色與時間，透過時間／來源清冊定位，在回答前提供當下需要的有限脈絡。需要精確內容時，再回到原始來源，而不是拿摘要補成原話。

**它不是另一個模型，也不替換宿主模型的專業知識、推理、人格或安全政策。**它不在回答後重寫成固定語氣。模型仍可能判斷錯誤；CMCP 的目的是提供可靠接續材料，不是保證永不遺忘或永不出錯。

## 這個版本能做什麼？

| 需求 | 使用方式 | 必須分清的界線 |
|---|---|---|
| 隔一段時間回來，接續普通聊天 | 每輪時間卡與授權來源保存 | 要有啟用的功能和實際接通的 Runtime／宿主 |
| 找回以前說過的內容與時間 | 時間清冊、本機候選及精確來源讀取 | 訊息時間不直接等於事情發生時間 |
| 先看命中內容的大綱 | **READ**：有來源支持的大綱、時間與範圍 | 摘要不覆寫原文 |
| 查看完整命中脈絡 | **READ-ALL**：界定並凍結集合，再分頁 | 不冒稱整個帳戶或所有相似話題 |
| 查證或統計普通歷史 | 分批查證／計數，可看覆蓋與續查 | 提及、計畫、否定與使用者實際回報不同 |
| 保留近期值得接續的內容 | **Buffer**：預設 12 小時，可調 6–48 小時 | 到期或 Clear 不刪原文，不取消獨立 Pin |
| 明確釘選一個目標 | **Pin**：指定目標，可自訂時間 | 沒設時間不自行提醒；發送不等於完成 |
| 決定 AI 何時介入 | 保存、時間、回查、Buffer、Pin、Clean、OFF、勿擾分別控制 | 主動推送總開關首次**預設關閉** |

本候選不需要向量資料庫或下載 Embedding 模型；已有本機定位與模型參與的語意判讀，但不宣稱任意語意查詢都能零遺漏。

## 原文、時間、暫存與釘選，各有責任

![CMCP 原文、時間、有限脈絡與可選推送的責任圖](docs/assets/architecture.zh-TW.png)

**History** 保存獲授權的原文；**時間／來源清冊**負責定位；**Buffer** 管理近期合格的接續內容；**Pin** 保存使用者明確釘選的目標。不是把同一份對話複製成四套記憶。

清冊獨立於會到期的 Buffer 候選，但可從接續流程調用。普通聊天沒有進 Buffer，仍可在之後回查。模型只收到本輪必要資料；使用者決定、Assistant 提案與未知事件時間不能互相冒充。

## 取得與開始使用

```sh
git clone https://github.com/redwakame/CMCP-TIME.git
cd CMCP-TIME
```

也可使用 `gh repo clone redwakame/CMCP-TIME`、SSH `git clone git@github.com:redwakame/CMCP-TIME.git`，或 GitHub **Code → Download ZIP**。正式發布的標籤／資產用來識別固定版本。GitHub 原始碼發布不代表已上架 npm，請勿假定 `npm install cmcp` 取得的就是本專案。

先準備 Node.js。套件宣告最低 Node 18；本次工程端 Windows 設定驗收使用 **Node 24.18.0、PowerShell 7.6.6、Codex CLI 0.154.0**，不是所有版本的相容性保證。

```sh
node scripts/cmcp-setup.mjs --help
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --host-workspace local-data/my-cmcp-host
```

這是一個命令啟動的**設定與接線精靈**，會確認保存範圍、時區、語言與開關。它不自動安裝 Node／智能體、不登入帳戶、不建立付費授權，也不替使用者開啟主動通知。套件沒有 npm 執行期依賴。

**使用 Codex：**選 host 模式，由 Codex 使用自己的合法模型存取，再審閱產生的專案 Hook。這條路不需要 DeepSeek Key。詳見[快速開始](docs/quick-start.md)與[安裝及宿主界線](docs/installation-and-hosts.md)。

**使用獨立 Playground：**需明確配置供應商、受保護憑證與有限調用授權；目前隨附的 configured 憑證路徑依賴 **Windows DPAPI／PowerShell 7**。DeepSeek 是已實作的參考路徑，不是核心必須綁定的產品定義。詳見[設定](docs/configuration.md)。

## 不只有 READ，控制也是產品的一部分

以下是 **CMCP Playground** 指令，不是所有宿主原生介面都接受的命令：

```text
/controls
/read 昨天關於運送方案談到哪裡？
/read-all 展開運送方案的完整命中討論。
/next
/set bufferRetentionHours 24
/proactive off
/pins
/clean on
```

先用 `/topics` 取得實際事件編號，再 `/pin`；或以正式來源 ID 使用 `/pin-source`。改時間、完成與取消分別是 `/pin-time`、`/pin-complete`、`/pin-cancel`。完整參數見[指令表](docs/commands.md)與[繁中操作指南](docs/operations.zh-TW.md)，不用猜內部識別碼。

主動呈現需要 Runtime 與通道運作。合格 Buffer 候選和自訂時間的 Pin，共用總開關、勿擾、來源檢查及去重。終端機顯示一則訊息，不代表手機收到、使用者已讀或程式能在關機後運作。

## 版本與驗收界線

目前是**可使用的工程候選版**，不是完整產品無缺陷保證。[驗收與已知限制](docs/verification.md)分開列出程式、原文、模型語意與宿主證據。

已核對的基準包含有限原文回查、每輪時間卡、獨立控制、本機 Buffer／Pin 派送，以及 Codex Hook／手動壓縮路徑；公開候選另有一般 Windows token 下的真實精靈及 helper 檢查。合成測試不冒充新一輪真模型驗收。

**尚未宣稱：**所有宿主、所有作業系統、自動壓縮全面可靠、無限容量、完美理解、雲端同步、手機推送及完整 History 刪除治理。Claude Code、OpenClaw、Hermes、DeepSeek Harness、Grok Bot 保留接入方向，不列成全部已實測。四語文件也不是四語行為全面認證。

## 參與與授權

歡迎提出可重現問題、使用回饋、獨立驗證與合作。請勿把私人聊天、金鑰或完整資料目錄貼到公開 Issue。詳見[貢獻方式](CONTRIBUTING.md)、[安全說明](SECURITY.md)、[隱私與資料](docs/privacy.md)及[後續方向](docs/roadmap.md)。

原作者與維護者為 **redwakame**。目前專案發布採 [Apache-2.0](LICENSE)，保留 [NOTICE](NOTICE) 與[上游授權沿革](docs/license-provenance-v0.1.md)。舊版本已授出的權利不撤銷；內部相容識別仍為 `cmcp`，對外名稱為 **CMCP-TIME**。[CITATION.cff](CITATION.cff) 提供方便引用的資訊，不新增每次使用都必須宣傳作者的條款。
