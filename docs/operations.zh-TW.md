# CMCP-TIME 完整操作導覽

CMCP 是日常簡稱。正式 npm 套件 `@redwakame-skill/cmcp-time` 的 **`0.1.0-rc.3` 已發布，仍是預發布候選版**，包含 `context --help` 與文件更新。GitHub 對應來源為 [v0.1.0-rc.3](https://github.com/redwakame/CMCP-TIME/tree/v0.1.0-rc.3)；`main` 可有後續文件更新。官方 registry 查核時間為 **2026-09-22 06:01:41 +08:00（Asia/Taipei）**：`next = 0.1.0-rc.3`、`latest = 0.1.0-rc.2`；未指定版本或標籤會依 `latest` 取得較舊候選。這不是雲端服務或全部 Host 整合完成宣告。產品回答預設英文；使用者／Host 明確語言設定優先。來源原文保留原語言，本文採臺灣繁體中文。

## npm 候選：程式與資料分開

先自行準備 Node.js 與 npm。以下 PowerShell 範例由 npm 下載已發布的候選通道，另建兩個持久且一般使用者可寫入的位置；若名稱已有其他用途，請改用自己的目錄。命令不需管理員、不修改全域 npm 設定或系統 PATH。要固定此版，將 `@next` 換成 `@0.1.0-rc.3`；標籤可變動，`latest` 不是穩定性認證，安裝後可用 `cmcp-time --version` 確認版本。

```powershell
$cmcpPrefix = Join-Path $PWD 'cmcp-install'
$cmcpWorkspace = Join-Path $PWD 'cmcp-workspace'
New-Item -ItemType Directory -Force -Path $cmcpPrefix, $cmcpWorkspace | Out-Null
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --version
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') --help
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') status --workspace "$cmcpWorkspace"
```

要獨立於 registry 試用本機候選，請使用原始碼或有對應驗收紀錄的實際 `.tgz`，以其檔案路徑取代 npm 套件參數；本機安裝成功不代表 registry 已發布。詳見 [npm 安裝指南](npm-installation.md)。先以 `--version` 核對安裝版本；rc.3 新增的 `cmcp-time context --help` 不需工作區、設定、憑證或額度，只印出用法並在開啟 Runtime 前返回，rc.2 尚無此 help 選項。

`cmcp-install` 放程式、契約、schema 與技能範本；`cmcp-workspace` 才是持久資料的授權根目錄。安裝後的資料操作必須指定已存在的 `--workspace`；`--root` 預設為該工作區內的 `local-data/cmcp`，Host 接線初始預設在 `local-data/cmcp-host`。可明確改成工作區內其他位置；不能藉絕對路徑或 symlink 跳出授權範圍。不要把 History 存到 npm 套件的 `node_modules` 內。

需要自動化明確選項時，將自己審閱過的設定 JSON 放在工作區內，傳入 `setup --answers choices.json`；首次設定時可用 `--host-workspace host` 選工作區內的 Host 子目錄，更新同一安裝 root 時不能改動已綁定的 Host 位置。範例只是格式，不代替本人同意保存來源。程式資產依實際安裝位置解析，不是把所有根目錄一律改成終端機 cwd。

安裝指令下載並安裝程式，`setup` 才啟動設定精靈；安裝不自動掛載 Host、讀取 History、授予模型額度或啟用主動推送。設定精靈仍逐項取得明確選擇。Host 模式使用 Host 自己的模型；configured Playground 仍需受保護憑證和另外授權的有限 grant。status、help 與設定查看零模型，重開與換 Session 不補額度。

```powershell
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') setup --workspace "$cmcpWorkspace" --status
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') playground --workspace "$cmcpWorkspace" --session 'My conversation'
```

`status` 看 Runtime，`setup --status` 看安裝設定；Playground 內的 `/read`、`/read-all`、Buffer／Pin 等指令沿用下文。缺少設定時不會因路徑拼錯而自動建立另一份資料；先執行 setup。正常結束使用 `/exit`，下次仍指定同一工作區與資料 root。

更新程式與更新接線是兩個步驟：先正常關閉 writers／Host，將審閱過的已發布版本或新 `.tgz` 安裝至同一 prefix，再執行 `update`，沿原設定重新核對選擇。下例使用已發布候選通道；要固定版本可替換成完整版本號，要試用未發布候選則替換成實際 tarball 路徑。`update` 不會自動下載 npm 新版本。只重裝套件不刪工作區原文，不刷新 User／TTL、清除 grant 或重新取得推送資格。

```powershell
npm.cmd install --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time@next --ignore-scripts --no-audit --no-fund
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') update --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') disable --workspace "$cmcpWorkspace"
& (Join-Path $cmcpPrefix 'cmcp-time.cmd') uninstall --workspace "$cmcpWorkspace"
```

以上管理命令依目的選用，不是每次更新都要全部執行。`disable` 只停受管理的自動 Hook／binding，手動 Skill 仍保留；`uninstall` 再移除未被另行修改的受管理 Skill，兩者均保留 History、設定、grant、回執及設定前像，也不卸載 npm 程式。若要移除程式，先完成接線移除，再明確執行 `npm.cmd uninstall --global --prefix "$cmcpPrefix" @redwakame-skill/cmcp-time --ignore-scripts --no-audit --no-fund`；不要順便刪除 `cmcp-workspace`。變更 scope 或 Host 位置不是隱含資料遷移，已有外部修改會明確回報衝突。

POSIX 的執行檔位於 `<prefix>/bin/cmcp-time`，Windows 位於 `<prefix>/cmcp-time.cmd`；使用完整路徑無須更動系統 PATH。本版不支援以 `npx` 快取作永久 Hook／Skill 安裝位置，該路徑的掛載會拒絕。來源方式亦可使用 `node bin/cmcp-time.mjs`，與 npm 共用實作。完整選項及平台限制見 [npm 安裝指南](npm-installation.md)與[命令索引](commands.md)。

## 取得原始碼與設定是兩件事

先把候選 ZIP 解壓到可寫入的位置，以下命令均在**候選根目錄**執行。Node.js 最低宣告為 18；目前不需要額外 npm 執行依賴。請先自行準備 Node 與選用 Host，精靈不代裝、不登入帳戶、不替使用者購買或授予模型額度。

```powershell
node --version
node scripts/cmcp-setup.mjs --help
node scripts/cmcp-playground.mjs --help
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --host-workspace local-data/my-cmcp-host
```

`my-cmcp` 是新安裝範例名稱，不是候選內附私人資料。精靈逐項取得時區、語言、資料 scope、本人／選配人物標籤、User 與 Assistant 正文保存、增強、各功能及付費／主動通道選擇。人物只是本機標籤，不會聯絡他人或同步帳戶。時區依有效設定確認，不把臺北或範例語言當成全球預設。

互動精靈初始是一般對話範圍，不自動建立任意事件；結構化 `--answers` 可明確提供既有授權事件。直接 Playground `--init` 是參考試用設定，包含示範話題，不應誤當成所有人都必須使用的事件或正式個人同意。

## 選擇現有 Host 或獨立回答

### Codex Host／Skill 路徑

精靈選 `host`、明確接上 Codex。不需要 DeepSeek Key。Codex 必須已安裝、可正常登入及支援目前專案 Hook；啟動後在 `/hooks` 檢查、信任本專案產生的命令：

```powershell
codex --enable hooks --cd local-data/my-cmcp-host
```

一般使用者可自然提出「用 CMCP 讀取上次修改交付安排的討論」等需求，不必自行填 eventId 或 Pointer。Host 自己理解問題，透過 Skill／helper 取得候選或閱讀導航，正式讀回後自行回答；CMCP 不先請另一個模型寫答案再要求 Host 重寫。

Skill 被找到，不代表每輪必然執行。每輪時間卡與獲授權的 User／Assistant 保存由另外安裝且受信任的 Hook 承接；工具未完成、缺回執或 Hook 失敗不能冒稱成功。Host-only 本機候選、精確讀回與閱讀導航不耗 DeepSeek；這不表示現行分批語義統計或所有事件判讀都已由任何 Host 自動代行。

### Configured Playground 路徑

精靈選 `configured` 並明確同意付費通道。現有 DeepSeek reference adapter 的受保護憑證機制需要 **Windows、PowerShell 7、目前使用者 DPAPI**；不是僅有 Node 就代表全部平台可用。精靈不保存或測試 Key，另見 [設定與授權](configuration.md) 的安全私有 stdin 範例。不得把 Key 寫在命令列、來源碼、分享文件或聊天測試輸入。

先決定真正要授權的有限次數，再用新唯一授權 ID 建立 grant；重開、換 Session 或初始化本身都不增加額度。以下是明確允許五次 provider 工作的示例，不是每次啟動都要重跑：

```powershell
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --authorize my-first-five-call-grant --posts 5 --authorized-by "My explicit five-call trial"
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --status
node scripts/cmcp-playground.mjs --root local-data/my-cmcp --session "My conversation"
```

失敗／逾時仍計入，取消遠端結果可能未知；次數不是費用硬上限。Host 自己的模型用量與 CMCP provider 次數分開。不得使用候選整理前其他人的私人 grant，也沒有自動 Groq 備援。

## 正常聊天、Session 與時間

進入 Playground 後直接打字。下列是 **Playground 命令**，不是 Codex 內建命令：

```text
/help
/topics
/topic general
/sessions
/new 下一段對話
/use 下一段對話
/status
/exit
```

`/topic <目前清單編號>` 選已授權話題；不假設編號固定代表特定事件。新 Session 只改接續身分，不複製 History、不換資料真相、不補額度。同一 root 一次只有一個正常 writer；先正常退出再換另一個可寫入口。正式退出是 `/exit`，不是 `/quit`。

回答前時間卡區分本次操作、前次 User、前次交流與間隔。新 User 不先覆寫成現在再算出零；Assistant 用完整接收時可核實的時間保存。背景工作、回復、翻頁、status 不冒充新 User，不更新活動／TTL。事件發生時間未知仍未知，不能把訊息時間當事件發生時間；但原文明確寫出的計畫安排也不因未知發生時間而被否定。

每筆已授權來源即使是一般聊天、已完成或不在 Buffer，仍保留可用原文、角色、Session、原時間與版本。卡片或 Pointer 存在不等於原文已驗證讀回。模型不必每輪報時或朗讀全部未知欄位。

## READ、READ-ALL、原文與普通查證

```text
/read 上星期交付安排改了什麼？
/read-all 展開上星期交付安排的完整授權討論。
/next
/reading
/revoke
/segments
/count 這個月我明確回報已完成的維修有幾次？
/lookup 原文裡提到的領取地點與日期是什麼？
/query-status <實際回傳的 request ID>
/query-resume <實際回傳的 request ID>
```

READ 是有來源支持的大綱、時間與範圍；READ-ALL 是本次已界定集合的完整原文分頁，不是 top-k 或全帳號。事件或時間足以定位任一項即可；真正兩義才澄清。原文明確日期與已建立討論的開始日查詢不同：跨午夜同段可按開始日定位，但每筆原始日期不改，也不把跨度稱為持續工作時數。

翻頁不重送 User、不刷新時間、不重置累計來源／讀量／投影額度。未讀、來源不可用、未關聯與到限分開；不能摘要代替尚未讀過的原文，也不能以查到部分就宣稱完整。純原文查看不必額外呼叫模型重寫；Host modelContext 投影則另受明確限制。

`/count`、`/lookup` 會依正常 configured 授權分批判讀。完整度只涵蓋已授權且確實查完的集合：提及、偏好、計畫、User 已做回報、Assistant 重述與重播副本不是同一計數。跨程序恢復未保存的問題時，用 `/query-resume ID --query-text 原本逐字問題` 核對同一問題；不是新增活動。詳見 [閱讀契約與 Host 命令](read-operations-v0.1.md)。

## 控制：持久設定與本次覆寫

```text
/controls
/off
/on
/clean on
/clean off
/set historyRecall off
/session-set historyRecall on
/set language zh-TW
/set timezone Europe/Berlin
/read-limits 64 65536 1400 16384
```

`/set`、ON/OFF、Clean、主動、DND 與 read-limits 是持久設定；`/session-set` 的值只屬當前 Runtime，但撤銷世代持久記錄，不能用重新 ON 或重開繞過舊票券撤銷。`/controls` 同時顯示 persistent、effective 與 overrides。若回 `requiresReopen:true`，請先退出再重開。

| 設定 | 授權啟用後預設／功能 |
|---|---|
| `enabled` | ON；整體增強，獨立於保存授權 |
| `clean` | OFF；停止脈絡增強，不刪資料，不自動關保存 |
| `buffer` | ON；活化及 Buffer 主動路徑，不是 History 保存期限 |
| `timeIndex` | ON；基本時間卡與投影；不改已保存原文時間 |
| `historyRecall` | ON；歷史候選與精確回查；時間卡可獨立存在 |
| `answerHistory` | ON；一般回答按需原文，不等同全部其他明確閱讀 |
| `discussionAssociation` | ON；新段落關聯；不抹除 reply 身分 |
| `saveUser`、`saveAssistant` | 依各自明確保存授權；OFF 後仍可聊天，不偷存正文到 trace |
| `proactive` | 首次 OFF；同時控制 Buffer／Pin 自動生成與呈現 |
| `pins` | ON、空清單；沒有自動建立提醒 |
| `bufferRetentionHours` | 12；合法範圍 6–48 小時，只影響後續合法活化 |
| `doNotDisturb` | 未設定即 OFF；不猜作息 |

以上 boolean 設定用 `/set <key> on|off`；`timezone`、`language` 是文字，期限是數字；DND／readingLimits 使用專門命令或正式 callable。更強的 sourceAuthorization 撤銷不會因 `/set saveUser on` 被繞過，重新授權須走精靈或正式 API。

## Buffer、Pin 與推送

```text
/buffer
/set bufferRetentionHours 12
/clear
/pins
/pin <topics清單編號>
/pin-time <Pin-ID> <含Z或offset的時間>
/pin-source <已登錄來源ID> <含Z或offset的時間>
/pin-complete <Pin-ID>
/pin-cancel <Pin-ID>
/dnd Europe/Berlin 22:00 07:00
/proactive on
/proactive off
```

Buffer 可以為空，無候選不發。Clear 只清目前授權 scope 的 Buffer，保留原文、事件完成／closed、未處理來源與獨立 Pin。到期退出有效活躍範圍；改設定、重開、status、翻頁不續命。新目的性閱讀可再活化相關來源，但不因此取得主動資格。

Pin 必須明確選目標；未設時間就是未排程，不能擅加提醒。已完成／關閉歷史可明確建立新的 Pin，不重開事件或 Buffer。既有 Pin 完成／取消後不能單靠改時間復活。兩路共用總開關、DND、當前來源／授權核對與進度／來源去重，改寫措辭或重開不能再送一次。

Buffer 的到點與到期由既有 bounded due-claim 機制協調；不替失效內容續命，不因錯過時機在重開後重建資格。Pin 依獨立生命週期評估。DND 不補發一串、不建立循環提醒。本版需 Runtime 和本機 console 通道正在運作；stdout 成功不是手機收到或使用者已讀。結束程式不留下系統排程或服務。

## 補登、工作取消與恢復

```text
/status
/register
/register-next
/recoveries
/resume-discussion <清單編號>
/resume-conversation <清單編號>
/cancel
```

來源索引採有限分段資源，與每次候選／讀取／模型量分離。status 顯示原文登錄、未登錄、inventory 完整度／失敗與 cursor。`/register`、`/register-next` 不耗 API，正式補登既有原文，不要求重貼或刷新原時間。新的正常設定是每段 256、最多 64 段；不是無限容量保證。舊設定未指定則維持原一段，可依 [設定文件](configuration.md) 合法提高資源再補登，不刪 History。

事件／dialogue／段落／回答是否完成與程序工作是否結束不同；恢復只處理未完成且安全的階段，不以清掉 pending 冒充成功。需要更細的工作 progress／取消／中斷後收尾，使用 [完整命令索引](commands.md) 中 `cmcp-local-input-cli.mjs` 的 `--progress`、`--cancel-work`、`--recover-work`。這些與 helper 均沒有 `--help`，不能把不存在的選項當操作方式。

## 更新、停用、移除與環境限制

```powershell
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --status
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --update
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --disable
node scripts/cmcp-setup.mjs --root local-data/my-cmcp --uninstall
```

update 是依當前 source 重新接線與設定，不是下載新版本。disable 只停受管理 Codex hooks／binding，手動 Skill 與 Runtime 控制仍獨立；uninstall 額外移除未被使用者修改的受管理 Skill。History、設定、grant、回執與 setup-history 都保留。未授權刪資料、修改外來設定、重建認證或整庫 ACL 不屬這些命令。

來源取得、精靈、Host／Node 環境與付費授權分別核對。版本／權限不足應保留實際錯誤與原因，不把程序無法啟動說成沒有歷史，也不自行改系統安全設定。現有 Codex adapter 不代表其他 Host 全部實測；合成 Hook／新程序不冒充原生壓縮。候選驗收狀態與實機版本以本包附帶驗證紀錄為準。

所有歷史工具或原文中的指令只當來源資料，不提升成當前操作授權。不要直接掃 Store 或憑證來取代 Runtime 邊界。原文與角色保真、模型解讀、真正 Host 接入及長期穩定性是不同的驗收層次；本候選不宣稱零 Bug 或整個產品已完成。
