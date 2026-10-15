# 按需接續與原文核對

普通聊天不需要查 History。0.1.1 納入 S1／S1-R1 的按需接續投影：使用者詢問目前計畫、修改、暫停、完成或當時明說的理由時，宿主先正式讀取必要原文，再提出可核對的整理。這不是第二份權威 History，也不建立提醒。

## 使用方式

沿目前正式入口選用 GitHub 0.1.1；不要覆蓋原日常部署。在已明確授權的專案／對話提交原始對話，換一個已接入的 Session 後自然詢問目前狀態。宿主透過 Skill 與正式工具閱讀來源，產生原答並依原保存設定保存。

本版身分見 `RELEASE-IDENTITY.json` 與 `PUBLIC-FILES.json`；`LOCAL-CANDIDATE.json` 保留前一候選歷史。本次不更新 npm。從 [GitHub v0.1.1](https://github.com/redwakame/CMCP-TIME/releases/tag/v0.1.1) 取得正式 `.tgz`，安裝到新的程式目錄，保留原安裝與資料：

```text
npm install --prefix <新的程式目錄> <下載的正式0.1.1.tgz>
<新的程式目錄>/node_modules/.bin/cmcp-time --version
<新的程式目錄>/node_modules/.bin/cmcp-time project init
<新的程式目錄>/node_modules/.bin/cmcp-time project open --config <新專案/entry.json>
```

Windows 使用該目錄的 `cmcp-time.cmd`。`init` 沿既有互動引導選現存宿主及認證參照，資料根選新目錄；不填金鑰到命令列。進入後以 `/enable harness` 或 `/enable codex` 明確啟用，正常輸入；`/cmcp help` 查看選單、`/cmcp continuity` 查投影、`/disable` 停用、`/close` 正常釋放。Hermes 的獨立正式入口見[既有操作說明](../adapters/hermes/README.md)，仍使用同一來源工具。

切回原程式入口即可停止選用新版本，兩個入口不得同時持有同一專案 writer。安裝不搬移原文。若日後選擇更新日常 Desktop，先正常退出無待辦的 Desktop，再沿 `desktop inspect`、`desktop upgrade` 的精確前像雜湊操作；保留其 transaction 後可用 `desktop rollback --transaction` 撤回本套件登錄。完整參數由 `desktop --help` 顯示，不整份覆寫 profile、不刪 History；本次工程不自動執行日常更新。

Harness 詳細視窗新增「接續狀態」分頁；按「讀取並核對目前接續投影」。原生命令為 `/cmcp continuity`，查看本對話最近投影。共享專案的人類 controller 同命令查看該授權專案最近投影，回執明列原 Session 與觀測 Session；不恢復原 Session 的執行權，也不是替觀測 Session 生成新投影。兩者都只重驗已保留資料，不會呼叫模型或替你產生新的判斷。

沒有投影不代表沒有 History；登錄待處理、控制阻擋、票券過期與未保存分開顯示。投影過期時可自然重新詢問，沿正式來源重新閱讀；不能靠刷新延長原時間或 Buffer 期限。原文與版本仍可沿既有正式閱讀入口查證。

## 宿主通用工具契約

問題需要歷史時，先找出必要來源、正式開啟並讀完選定集合。若材料仍缺，補讀必要來源或明示不足；有限集合不是全部歷史。不因普通聊天而每輪搜尋、摘要或呼叫第二模型。目前訊息已足夠的新計畫直接回答，不先檢查是否有歷史；空導航不發明選項，已消耗票券不能重播。

當使用者需要目前狀態、修訂或明說理由的整理時，完成必要正式閱讀後，使用 `cmcp_project_continuity` 提交 `ticket` 與 JSON 字串 `proposalJson`。正常新提案使用 v6 型別入口 `{version:6,plans:[...],reports:[...],suggestions:[...],unknowns:[...]}`，在各計畫內明示修改鏈。v1 至 v5 保持相容；下列 v3 章節說明共用 Core 契約。Harness 與 Hermes 的回答前規約共用此責任，不另執行第二份回答流程。

### 先選來源功能，再建計畫

先依原句功能選 kind，再填計畫欄位。User 回報當前事實，包括某事尚未發生、未完成或未確認的狀態，仍用 user_report／current，不能因否定或未完成改成 user_intent；unknowns 只補真正未定，不代替已明說的回報。planRole、planStatus、planChanges 與 retentions 只用於真正 User 意圖，不為排除錯誤改 kind。同一回報再次確認可留一個 current 代表，其餘原句用 historical／related 保留；只有明示事實更正才用 supersedes。一次性的回答／提建議請求用 user_question 與正式問答關聯保留；已回答不再列為持續主題計畫，也不自行建立完成狀態。同句中的長期條件或未採限制，另用精確引文依原功能保留。

這項順序由共用回答前協定、四份 Skill 與工具說明共同提供。它不自動分類或改寫 User 原句；模型須依來源判讀，正式來源與 Core 守護仍各自核對。

### 轉述的角色與修改面向

正式來源的角色是原句說話者，不一定是句中提案或行為的作者。直接引文中的我／你／我們／這次均以原說話者、對象及原回合為準；自然轉述必須換回現在的說話視角，或明稱來源中的 User／Assistant／具名 Host。另一方的提案被 User 提及，不會因此變成 User 提出的建議；跨宿主不要把前一宿主的發言或操作說成本宿主親自做過。原文引號內保留原代詞並標說話者，引號外不得照抄代詞而移轉作者。不能確認指涉時保留中性名稱及已知來源，既有明確角色不降為未知。

kind 已確認為 user_intent 後，v3 計畫建模再區分能各自修改的面向：每個 basis 的唯一精確引文只承載該面向的條件，不把整則訊息中的其他條件或歷史理由包成同一基底。理由用該版本的 reason 正式引文另綁，不因參數替換而把舊因果句拼成新條件。同一 User 訊息修改多個面向時，分別對各自 basis 建立 planChanges；每筆 change.reason 只解釋其實際修改範圍。不同面向的原因不同，不能合成一筆變更後只掛其中一個原因；原文明說的各項原因須逐項保留，沒有明說的才保持未提供，不補原因。狀態修改同樣只指被暫停／取消的面向；其他條件、門檻與未採納提案保留。送出前檢查每項 currentPlans 的內容、reasonBindings 和修改範圍是否對上原文，不以結構 ready 代替此核對。

這是送入正常宿主的通用協定與工具契約，不改原文、不自動判定自然語意，也不事後修改原答。Core 仍檢查正式角色、引文、來源、版本及明示修改；自然語意另由同版宿主驗收。

### 精確來源與計畫基底

- `nodes` 最多 24 個；必填 `id, ref, quote, kind, temporalUse, topic, aspect, relation`。`ref` 必須屬於本次閱讀票，`quote` 必須是已完整閱讀、已提供模型材料且可唯一定位的逐字引文，不補字、不修文。
- `kind` 為 `user_report / user_intent / user_question / assistant_suggestion / assistant_statement / tool_observation`，必須符合正式角色。計畫與尚待執行的決定用 `user_intent`；User 完成回報不等於工具已核實外部操作完成。
- v3 的 `user_intent` 可以省略 `text`；提供時必須逐字等於 `quote`。其他節點仍須 `text`。計畫基底不能用自由改寫添加條件、理由或授權。
- 一般 `temporalUse` 支援 `current / historical / unspecified`；v3 計畫基底（basis，含省略角色的相容提案）只用 `current` 或 `unspecified`。前者是本題已納入的計畫條件，不代表已完成；後者不自動取得目前效力。不能只因來源較舊就標失效，也不能將已納入的基底改標 `historical`，讓未改條件消失。evidence 可保留實際時間效力，但不因此建立獨立目前計畫。
- `relation={kind,targetNodeIds}` 可用 `independent / related / unresolved`；獨立節點的 targets 為空，其他 targets 須存在、不自指、不循環。`supersedes` 仍只用於同主題／面向的明確事實更正；v3 計畫不用 `supersedes` 或整節點 `revises`。真正競爭或未定須有原文支持，不能用 `related`、`unknowns` 掩蓋結構錯誤。

當輪修改需要成為正式引文時，在 `cmcp_open_history` 加 `includeCurrentInput:true`。它只附入可信宿主已保存、已登錄、未變版的當輪 User 原文；不接受呼叫者指定 Pointer、角色或時間，也不活化 Buffer。未保存、待登錄或撤權時拒絕；空歷史或仍需澄清的導航不能當成只讀目前訊息的捷徑。

### 內容與狀態分開修改

`planChanges` 最多 24 筆，每筆必填 `id,targetNodeId,afterChangeId,kind,ref,quote`。`targetNodeId` 指同份提案的 User 意圖基底；第一次修改使用 `afterChangeId:null`，後續修改明確指定同一目標的前一個 change id。Core 不用陣列位置或日期猜取代順序；同目標有競爭分支時，保留在 `unresolvedPlans`，不自行選勝者。

| 修改種類 | 欄位與效果 |
| --- | --- |
| `status` | 另填 `planStatus: planned / paused / cancelled`，不填 `parts` 或 `text`。只改目標狀態，保留原有條件與理由；部分暫停不能變成整案取消。 |
| `content` | 另填 `parts:[{quote,kind:'keep'|'replace'|'withdraw',replacement?:{ref,quote}}]`，最多 32 段。依序串接的舊 `quote` 須完整等於前版內容，包含空白；只改指定片段，其他明列 `keep`。 |

`replace` 的 `replacement` 必須來自這次修改的同一 User 來源，且位於修改引文範圍內；`withdraw` 也須有明示撤回來源。Core 計算 Unicode 字元範圍並保留每片來源，不要求宿主自行計算長句位移。少片段、重疊、錯誤前驅或自由改寫會拒絕，不能以整包退休丟掉未改限制。範圍完整只證明各片已交代，並不證明宿主選取的修改語意正確。

`currentPlans` 保留 `sourceFragments`、`planVersion`、`statusSource` 與 `changeId`；`planChanges` 回執列出前後版本與保留／替換／撤回的原片段。`currentPlans.text` 只是正式片段合成顯示，可能保留原標點，**不是新 User 原話**，也不是供模型照抄的標準答案。原文、來源角色及原時間仍以片段回執為準。`planBasis` 與 `planCoverage` 只涵蓋本次提出的來源基底，不宣稱全 History 已解讀完整。

### 計畫基底與修訂證據

新 v3 提案的每個 User 意圖節點明設 planRole：basis 是可獨立承接條件與狀態的計畫基底；evidence 只是修改、狀態、理由或維持的原文證據。純證據不另列待執行計畫、不帶 planStatus，也不能作 planChanges 目標；仍保留原話、角色、時間及正式查閱。User 意圖需要關係起點時用 evidence，以 related 明指同題實際 basis，並由同一正式引文的 planChanges 或 retentions／reasonRelations 明示引用支援；沒有這些關係不憑同來源或相似度藏掉獨立計畫。內容及狀態只在被指向的 basis 經 planChanges 演進，最後核對 currentPlans 沒有把修改指示再列成新計畫。

v3 的 user_intent 新節點明設 planRole:"basis" 或 "evidence"；只有此 kind 省略時才為舊提案相容按 basis 處理。user_report 等其他 kind 不帶 planRole 或 planStatus。evidence 必須是精確正式 User 引文，以 related 指向同 topic 的 basis，且由對應 planChanges（同來源精確引文範圍）或 retentions.byNodeId／reasonRelations.fromNodeId 明確支援；不能帶 planStatus、不能被當作修改目標。它的時間、reason 及關係仍保留，另列 planEvidence，不會進 currentPlans。只含修訂／暫停／理由證據的訊息不是獨立目前計畫；真正新計畫才用 basis。不得用 unspecified 一律藏掉這個分工。

### 理由、維持與未定

理由歸屬須連同它解釋的決定及版本保留。舊理由未撤回、或「其餘維持」，不等於它已成為後來每次改動的原因；新參數也不能倒填到原本的因果引文。比較時分開原決定的理由、本次修改明說的原因、仍保留的顧慮與新的優先／取捨；只有來源明確支持才連接。需要整理理由時，在投影用正式 reason 及必要 reasonRelations 表達作用對象，不只埋在一般 text；缺欄位依具名 correction 修正，不能刪必要理由關係來取得 ready。

v3 的 node.reason 只解釋其引用節點；basis 綁原基底版本，evidence 綁來源節點，均不隨 currentPlans 的新值移轉。planChanges 可另附 reason:{ref,quote}，必須是本次修改同一 User 來源中的明說原因，回執只綁這次 change。沒有附 reason 只表示未提出理由關係，不證明 User 沒有說明。reasonRelations 的 targets 必須各自有 node.reason；adds／prioritizes／accepts_tradeoff 的 fromNodeId 也須帶 User reason，即使該節點本身 quote 已寫理由也要明設 reason 引用。意圖的純理由證據節點才用 planRole:evidence；事實回報的理由保留 user_report，不帶計畫欄位；關係與原文對應仍需判讀，不由 Core 自動裁決語意。

節點可附 `reason:{ref,quote}`，只記當時明說的理由。User 計畫／回報的理由必須來自 User；Assistant 補充、常識或保守做法不會變成已採納條件。新理由、優先順序、接受取捨與明示撤回分開；改參數不自動撤回舊理由，未撤回也不代表永遠同等適用。

`reason.standing` 只表示該理由節點的站位，不是整個主題的全域目前效力；後來重新採納可由新的 User 理由來源與關係保留，須合看正式原文判斷。

- `retentions:[{byNodeId,targetNodeIds,ref,quote}]` 記錄同主題 User 計畫之間的明示維持。`ref` 必須是 `byNodeId` 的 User 來源，targets 指具體基底；泛稱「其餘維持」不能代替那些條件，也不能復活已撤回片段。
- `reasonRelations:[{kind,fromNodeId,targetNodeIds,ref,quote}]` 支援 `adds / withdraws / prioritizes / accepts_tradeoff / unresolved`。targets 必須有 User 理由；新增、優先與取捨的起點也須有理由。關係的 `ref` 必須等於 `fromNodeId` 的 User 來源；只有明示 `withdraws` 撤回指定理由。
- 新理由來自後一則 User 訊息時，新增該原句的來源節點作為 `fromNodeId`，不要改寫舊基底的 ref，也不要把 `planChanges.id` 當作 node id。若該原句屬 User 意圖且僅承載關係證據、不另成目前計畫代表，明設 `planRole: evidence`；事實回報仍用 `user_report`，不帶計畫欄位；`temporalUse` 只描述實際時效，不能代替計畫角色。原條件仍由原基底與稀疏修改呈現。
- `unknowns` 最多 16 條純字串，只列本題真正未定或材料缺口。來源已清楚的條件不能因工具或結構尚未完成而降為未知。

同狀態再次回報不等於新的衝突或取代。保留一筆目前代表，其餘原句可作 `historical`／`related` 的關聯證據；明確回報不能改稱未知；不為去重捏造 `supersedes`，也不拿計畫專屬的 `retentions` 連接事實回報。

### 更正、相容與驗證層級

`rejected/correction` 時，沿同一份正式原文修正提案，不重讀全庫、不刪必要關係求通過，也不要求 User 重述已明確的決定。`continuity_plan_relation_required` 要核對基底是否重複或存在真歧義；v3 的實際修訂走 `planChanges`。`continuity_plan_scope_incomplete` 要補齊精確舊片段；`continuity_claim_relation_required` 則針對回報／工具觀察，不能與計畫混用。

v1／v2 提案與既有持久事件契約保持相容；省略版本仍是 v1。v2 的計畫 `revises` 與舊時間用途屬舊契約，不是 v3 新提案的操作方式。本次只擴充查詢衍生投影，沒有讓永久 event store／working-set 自動啟用新狀態機或每輪分類。

`currentPlans`／`unresolvedPlans` 與 `currentClaims` 分開，CLI、slash 與詳細視窗查看同一份正式回執。`validation` 分列結構、來源、語意與執行授權；`ready` 不代表自然語意已認證，不取得 Pin、追蹤或外部工作許可。依證據自然回答時，User 已定條件與 Assistant 未採用建議仍須分開；只有真宿主原答驗收才能支持該版本的語意結論。

每次工具生成與查看都沿當前授權、控制、來源版本及原票期限重驗。停止 Assistant 保存時，當次投影可回傳但不保留正文供後續查看。重新啟用不恢復舊票權限；解除接線不刪 History。

正式閱讀完成與模型材料覆蓋分開。引文須出現在正式工具已生成的 `modelContext` 頁面；缺少該材料即拒絕投影。選定集合仍有頁面未進入模型材料時回 `partial / model_material_incomplete`，不能宣稱完整現況。Core 能核對的是正式工具材料，並不觀測供應商是否實際消費或理解；真宿主材料與原答另以正式接點證明。

正式分頁的精簡 `contextVersion:2` 保留原文、角色、UTC 原時間、時區、範圍及來源雜湊，省略可重建的重複時間欄位。需要舊衍生時間欄位的本機消費者可用 `expandCmcpReadingPageContext` 明示展開；正常模型材料保持精簡版。宿主每頁原文上限為 4,096 bytes，總原文仍為 65,536、模型投影仍為 16,384 bytes；未讀與未投影範圍如實揭露。這些是有界材料限制，不是所有歷史容量或模型輸入總量。

## 能力邊界

這是查詢範圍內的可修正衍生解讀；普通來源不自動取得永久 eventKey。既有明確事件仍使用 event-lineage 與有界工作集。是否真的完成、因果與理由是否正確，仍須對照原文及本次宿主原答驗收，不能靠引文格式或工具成功自評通過。

### 來源限定與建議分界

整理 User 已定條件、理由、現行流程與必要門檻時，每一項均須由 User 原話支持；Assistant 的補充、保守做法或常識不是 User 條件。建議可另外提出，但須明示尚未採納，不混入既定流程，也不擴大 User 限定的對象、位置、權限或工作範圍。這適用首次草稿及後續修訂，不只適用最後回查。將內容列為 User 已定條件、要求或必要流程前，逐項核對限定對象、數量作用範圍、時間次序與依賴是否由原話支持。特定部分的條件不外推到所有部分；原文未建立前後依賴時，不自行以完成一項作為討論或開始另一項的必要門檻。方便實作的安排仍是 Assistant 建議，不能因放在規劃、整理或步驟清單中就算 User 決定；未採建議區的聲明也不能替其他區塊新增的條件授權。

這是同一宿主回答前的通用規約，不是回答後改寫，也不由 Core 假定能自動核實自然語意。正式分類、原文及版本守護保持；實際語意由同版原答另行驗收。

### v4 薄輸入與語意責任

正式投影新增相容的 v4 輸入，把唯一舊片段修改與內嵌關係證據機械展開為原 v3 Core 契約。引文、角色、來源版本、完整閱讀、取消與控制仍由原正式路徑核對；不自動判斷同案、理由撤回或使用者決定，不產生答案。舊輸入保持相容。新輸入與較短共用 Skill 旨在減少重複接線；實際語意必須另驗，不能以編譯成功冒稱完成。

### 來源作者與目前讀者、狀態附帶條件

共享正式入口於 request-context 與 read／continuity 封套提供可信 readerIdentity；sourceOrigins 以本輪票券、ref、Pointer 及原件雜湊對照來源作者。readerComparison 的 Host、Agent、Session 比較只表身分，不表示採納、模型能力或執行權。缺少可信身分時明示未知，不能推定跨宿主仍是同一作者；原 Core 投影雜湊保持其原範圍。

狀態經 v5／v4 編譯後仍沿既有 v3 契約；status 引文須包含作用範圍及明示恢復前提，正式 currentPlans.statusSource 保留該原句。這是有來源的衍生狀態，不啟用任何派送或外部操作。unknowns 明確採字串陣列。上述接線與契約補正的真宿主語意結果另行驗收，不以欄位存在代表完成。

### 目前計畫的使用選擇與真正未知

計畫基底的 temporalUse=current 代表本題選用該基底計算目前計畫；不表示原案所有內容仍有效、已經執行，或改寫原時間。明示修訂仍逐項套用。真正未確立的 unspecified 保持合法，不自動升為目前計畫；其原件與候選顯示於 unresolvedPlans，planCoverage 分列已選與未確立基底。外層 ready 繼續表示來源材料及結構層級，不是語意完成或執行授權；空 currentPlans 搭配未確立候選不可當成沒有計畫。修正提示亦明確區分以上情況，不能以全改 unspecified 躲過更正。


### v5 型別入口與修改理由

v5 將 plans、User reports、Assistant suggestions 及其他角色 context 分區；每個計畫的 orderedChanges 明示修訂先後。入口產生內部 id 與前後依存，保留完整未修改片段，沒有由時間或相似度推定同案。獨立理由、暫停指示與完成回報不應另列為待執行計畫。這是舊 v5 相容輸入；新的 v6 入口見下節，完整宿主契約由成功正式閱讀結果提供。

修改可附同則 User 正式引文的 reason，選配 adds／prioritizes／accepts_tradeoff。只增加或改變理由時，kind=reason 保持條件、狀態與 planVersion，另留修改回執；不假造參數更新。明示撤回可指原基底理由或 orderedChanges 中既存理由。Core 重新核對來源、角色與目標；理由關係仍是可更正的宿主解讀，結構通過不證明引文確實表達撤回。暫停或參數修訂不自動撤回理由。

上述分區與編譯不產生回答、不新增第二份 History、Pin、事件授權或外部執行。使用者可用 CLI／slash／既有詳細視窗查同份結果；模型可採不同措辭與建議，語意判準始終是正式原文。普通聊天不因這份契約而需要搜尋或投影。

### 歷史理由的精確呈現

目前計畫保留的正式原文可能包含後來明示撤回的理由。外層 `presentation` 只依已驗來源與具名撤回關係，標示兩者精確重疊的字元；不刪原文、不改計畫版本或原投影雜湊，也不把相鄰條件一起撤回。註記綁定 scope、投影及計畫版本；無法核對或舊版缺少精確片段時明示不可提供，空註記不表示全部理由仍有效。CLI 與工具保留同份結構化註記，詳細視窗將該段標為歷史理由。

接續投影本體上限為 65,536 bytes；與正式分頁的 16,384 bytes 材料限制是不同層級。這次只補足已量測的投影本體容量，沒有增加閱讀頁數、原文額度或宿主工具步數。可信宿主身分等外層欄位另外計入實際模型材料；上述上限不是整份模型請求大小。超界仍拒絕，不裁原文或用部分內容宣稱全集。

### 修訂指令與已定條件的來源

修訂、維持與暫停指令沿 orderedChanges／retentions 表示，不重複升格成目前回報。新的 v6 用 context:user_instruction 保留一般工作限制與本輪回答指令，提問用 context:user_question；明說的已發生、未發生或目前不確定狀態才屬 reports。同句兼有兩者時，各自保留對應原片段。

Assistant 原答中的細節仍屬 Assistant。使用者繼續修訂或維持其他已定條件，不自動採納原先未採納的提案；可見答案必須把提案與有 User 來源的條件分開。本輪通用規約調整沒有新增自然語言關鍵詞判定、答案模板、控制權或第二份 History；結構與來源核對仍不能自稱完整語意驗證。

### Hermes 單輪期限與停止回執

Hermes 正常 `chat` 入口依設定中的 `timeoutSeconds`（預設 600 秒）限制單輪執行時間。到期沿官方中止接點要求取消，保留停止原因；這不是強殺程序，也不自動重試。只有子程序退出且正式釋放回執成立才回報 `stopped`，尚未釋放則為 `stopping`。逾時後即使晚到一份回答，也不把該輪當成成功完成。原生模型參數、來源票券期限與保存守護維持原責任。

### 自我約束、前提與未知

按整句的溝通功能區分：決定、承諾、接下來做不做及工作範圍的自我約束，仍是意圖；現在式、否定或停止用語本身不能證明它是行為現況回報。真正明說已做、尚未做或尚未確認的回報照原意保留，不因否定一律改成意圖。附在既有計畫狀態的限制與前提保留在完整狀態引文；獨立的持續條件才作自己的計畫基底，不為多存一次而複製到 reports。

分開核對前提是什麼、前提是否已滿足、何時滿足及滿足後是否執行。原文明示的前提內容是已知；只有未明說的滿足狀態、日期或後續決定可以保留未知，不能把整個已知前提一併列為未定。缺外部回報不等於已證實尚未發生。理由須由來源明說的因果或明確指涉支持，並列條件與限制不自動成為原因；工程或模型推論須另標推論，不冒充 User 原理由。

這些是所有接入宿主共用的來源判讀規約，不是自然語言關鍵詞檢測，也不提供案例答案。Core 的引用、角色、修改、來源版本及控制契約保持；結構可接受仍不等於語意已驗。

### 重疊來源的作用範圍核對

投影的 planScopeReview 列出某目前計畫已修改、另一目前計畫仍引用的精確來源區間；它是作用範圍待核對，不證明兩者必定衝突。回答前沿 node／change／ref／range 核對原話中的對象與條件：同一實際條件已被修訂時，修正所有含該舊限定的目前表示，可將各 basis 縮至完整的實際面向或對重疊基底明示一致修改；不能只把可見答案寫對而保留錯誤投影。若原文明確為可獨立修改的不同對象，保留未被修改者，不自動傳播新值或捏造其餘維持引文。不要刪必要條件、設 unspecified 或把已知降 unknown 來消除疑點；真正無法判定作用範圍才如實列未定。無疑點也不等於語意已驗。

Core 只依已驗正式來源身分、版本、雜湊、Unicode 區間及明示修改鏈列疑點，沒有從同 topic 或相似度推定同一作用對象。不拒絕合法的獨立局部修改，也不修改 currentPlans、原文、時間或授權；結構 ready、待核對疑點與語意已驗分開。這是本題有界衍生查證，不另起模型、永久分類或第二份 History。

宿主為面向自行命名不同 topic／objectId，不會阻止上述正式來源區間核對；名稱不同本身不是原件不同或修訂不相干的證據。提示仍不能替宿主判定不同實際對象必須共用新值。

### 明示理由效力與優先的分工

分別核對理由的來源、對指定決定／版本的效力、以及本次明說的優先或取捨。明說保留的顧慮是已知；明說的新優先也已成立，不需先撤回舊顧慮或補出完整排序。兩者可並存，不能又把是否保留列成未知；未說的相對權重仍不代定。明說某理由不再適用或不再作為指定決定的依據，按該指涉範圍表示效力更正，不要求出現特定撤回字樣；原理由與原時間仍留在歷史，不把更正擴及其他決定。

這是對正式來源的通用解讀責任，不是依關鍵詞自動撤回理由。Core 的 standing 只記已提出的來源關係，not_explicitly_withdrawn 本身不表示目前有效或真正未知；須合看原文及指定決定。結構驗證仍不裁決自然語意，也不增加控制或執行授權。

### 每張閱讀票券的來源身分與漏件修復

每次 open 的 ref 只在該 ticket 有效；重新開票須依正式角色、原時間與 Pointer／版本重對來源，不沿用前票同名 ref。修訂後又修改狀態時，必要材料包括原案、有效的中間 User 修訂及本輪要求；Assistant 整理不能代替漏選的 User 原件。完整讀完選定集合不等於已選齊必要來源。引文缺失時先分清錯 ref、漏選原件或引用不精確，沿 find／open／read 補正必要範圍，不重讀全庫、不移除修訂求 ready。edit 的舊片段依指定基底及之前 orderedChanges 核對，不能拿另一面向的片段替換。若更正回饋指出舊片段缺失或不唯一，先依 correction.issues[*] 定位該 edit；previousVersion.preview.status=available 時，以 preview.text 核對該步之前的實際片段，再修正基底、目標或精確引文。這是正式來源核對過的機械前版（basis 加上成功套用的先前 changes），sourceBindings 提供 ref、range、角色、原時間與雜湊；proposalAccepted=false、semanticVerification=not_performed，不表示提案已接受或語意正確，不得作為新 User 原文、ready 或執行授權。preview 缺少或 unavailable 不代表前版為空，超界不截斷；保留必要條件、理由及其他有效修改，不能刪減內容求通過。unknowns 也是宿主解讀，涉及提案或來源時仍核對原作者，不能把 Assistant 建議改稱 User 提案。

更正回饋只能指出已提交表示與已授權閱讀的缺口，不授予新的來源、資料範圍、控制或執行權。補讀仍使用目前有效權限及既有正式 reader；沒有自動全庫擴讀、猜測引文或修改原文。

### 回答前材料按需分層

每輪只保留短的來源責任與正式閱讀路由；普通新問題不因 CMCP 進行分類、搜尋或投影。成功開啟正式閱讀集合時，模型工具結果另附有版本／雜湊的 `continuityContract`，提供完整修訂型別與來源核對契約。它是靜態宿主規約，不是 User 原文或授權，也不表示來源已讀完。原時間、控制、頁面覆蓋及正式引文驗證保持。完整契約在 `adapters/continuity-reading-contract.mjs`；各宿主 Skill 仍保留正常操作入口。

Harness 透過官方非同步 `system-prompt/assemble` 接點，為當前已明確授權、共用控制有效的對話追加固定短規約；保留原生身分、工具、其他技能及環境欄位。原文與工具結果不因此取得系統規約的權威。組裝前後核對當前 Agent 身分、回合、控制及取消；舊 Session、OFF、Clean 或失效綁定不追加。組裝準備回執不能單獨證明模型已收到，實際 `llm/stream` 位置觀測另列。此接線不新增模型流程、不修改控制，也不強迫普通聊天回查。

正式投影的 `presentation.evidenceLayers` 將目前計畫／回報連回同一投影既有的分類、來源角色、原時間、引用區間及限制。計畫與門檻不是外部結果，User 回報也不等於工具獨立核實；這個唯讀對照不重新判讀語意、不產生新事實或執行許可。缺件、身分衝突或超出有界容量時明示不可用，不以空集合代替未知。原文、投影及其雜湊保持。

### 訊息作者與條件來源

來源角色描述誰說了這則原文，條件的決定來源則沿正式 User 原件、明示採納及有效修訂核對。Assistant 同一段可能同時重述既定條件並提出新建議，不能整段採納或整段否認；來源缺件與尚未採納也是不同狀態。理由撤回分開核對原理由及撤回它的來源，不以一個撤回指示同時充當它自身的原理由。這些表示與精確來源檢查不等於自然語意或外部執行已通過驗證。

### v6：同一計畫的多個理由

同一計畫可用 `reasons:[{id,ref,quote}]` 個別保留多個明說理由，不必拆成重複計畫。每次修改也可用自己的 `reasons` 附 adds／prioritizes／accepts_tradeoff；原理由與新修改原因各自有正式來源及版本。

明示撤回用 `reasonWithdrawals:[{ref,quote,temporalUse,targetReasonId}]`，只作用於同一計畫既存的指定理由。新格式不混用舊單一 `reason` 或 `target`。新投影以單一 `reasonBindings` 顯示具名理由、所屬計畫／修改版本、原來源／時間與效力；舊 v1 至 v5 表示保持。這些身分只供當次來源核對，不是任務授權或第二份 History。

正式閱讀、精確引文與角色／控制仍由同一 Core 檢查。多個理由的語意界線由宿主依原話提出；資料合法不代表已經語意驗收。新格式的真宿主與介面結果，須以本次同版交付證據裁決。

### 更正回饋與理由範圍核對

reasonScopeReview 只提示內容修改碰到同一計畫已具名理由的正式來源片段，不證明理由錯誤或已撤回。依 reasonId、changeId 及來源範圍核對：內容 edits 的 withdraw 只改計畫文字，不能代替 reasonWithdrawals；原文明示撤回才建立指定理由關係，明示保留則保留，不為清空提示而撤回或刪除理由。未提供的理由無法由此偵測，沒有提示不等於語意完整。

欄位或角色拒絕會指出出錯項目及正式來源角色，供宿主核對後重送完整提案；不替宿主改種類、不合併先前被拒提案、不修改原文。結構與來源通過仍不代表語意通過。

### 完整投影與模型傳輸容量

`projectionCapacity` 分列完整查證投影及無損編碼後的模型投影：完整投影上限為 128 KiB，模型投影上限為 64 KiB。量測範圍只有 `projection`，不是整份工具訊息；外層回執、來源宿主身分與編碼說明另計，仍受各傳輸的封套上限約束。原文、提案、節點、閱讀頁與覆蓋的既有界限保持。

模型出口與 Core 共用同一編碼。現況、理由、來源、時間及覆蓋直接可讀；次要欄位中的完全相同物件可用 `$cmcpExactRef` 指回同一結果內的完整值。這不是刪節、摘要、外部網址或新的語意關係。查證回執及人類狀態入口保留完整投影；模型出口在加入正式宿主身分後才編碼，還原時核對雜湊，並限制展開容量、深度及工作量。

超限仍拒絕，不裁掉必要理由／條件或以縮小覆蓋換取成功。重複傳輸先驗證原編碼；改動已編碼訊息的欄位不能冒充同一正式結果。上述容量與完整性通過，不代表宿主對自然語意的解讀正確。

### 正式結果的有界完整傳輸

大型接續結果沿同一正式工具分頁傳輸。`cmcp_project_continuity` 若返回 `cmcp_continuity_delivery_page`，第一頁的 `delivery.id`、`delivery.nextPage` 與同一 `ticket` 是後續 `cmcp_read_continuity` 的 `deliveryId`、`page` 與 `ticket`；CLI 使用等價的 `continuity-page`。按順序取得各頁，直到 `delivery.complete=true`，不要重送提案代替取頁。較小結果維持完整直接回傳。

每頁 `sections.path` 是同一完整結果內的 JSON Pointer。`value` 保留完整子樹，`container` 表示容器，`stringPart` 按 `start` 串接；全頁取得後再解析其中的精確參照。`resultHash`、bytes 與字元數可由 `restoreContinuityDelivery` 核對完整性；單頁最多 32,000 個 UTF-16 字元，完整結果仍有容量及頁數界限。這是短期傳輸視圖，不新增權威 History 或縮成 top-k。

投影產生、正式工具全頁已提供、模型實際取得及語意已驗各自有不同證據。`delivery.complete` 只證明正式工具已提供同一結果全部頁面；不能代替宿主輸入觀測、模型理解或自然語意驗收。分頁不把 `partial` 的來源覆蓋或作用範圍疑點改成通過。每頁重新核對來源版本、票券、對話授權、控制與取消；失效或超界就明示拒絕，不讀宿主 spill、延長舊票或拿部分材料宣稱完整。

### 現況回報與計畫狀態共用來源

reportScopeReview 只指出同一正式來源片段兼作計畫狀態與現況回報，並不證明語意衝突。未解時返回 partial/report_scope_review_required；沿 finding 核對完整 User 原話、report 與 status 的正式來源範圍。若是計畫、暫停／恢復前提或指令，從 reports 移除誤列項，完整條件仍保留在 plan/statusSource，不改列 unknown、不刪前提或縮引文繞過待覆核。若同句確有獨立的已發生、未發生或目前不確定回報，可在 reportScopeResolutions 提供 findingId、kind=reported_state_in_status_clause、reportRef 及逐字 reportQuote，引用原句實際回報的完整子句。Core 只核對來源、版本及範圍，這個明示用途仍是宿主解讀，不等於語意驗證、外部完成或執行權。

此檢查不分析固定關鍵詞，不把所有文字重疊當成非法。沒有重疊也不代表語意已驗；目前 plan／report 的實際意思仍須由原宿主依正式原話區分。解除待覆核只代表提供了可核對的解釋，不修改原訊息、角色、時間、Buffer TTL 或授權。

### 原話聲音與工作指令

新的 v6 `context:user_instruction` 保留正式 User 原話中的一般工作範圍或當輪指令，不進目前事實與計畫，也不產生新的執行授權。已有計畫的內容、暫停或維持仍沿正式修改鏈，不能改標為一般指令而逃避修訂核對。v1 至 v5 與既有事件寫入的接受範圍保持。

新 v3 投影的目前回報附可核對的來源、角色與原時間。`textUse` 區分逐字原話與宿主解讀：原話中的我／你屬於原說話者與收話者，引用須標來源，轉述須核對主體；不能直接當成目前 Assistant 自述。計畫的 `source_bound_plan_not_external_outcome` 標記表示它是有來源的安排與狀態，不能據此聲稱工作已在外部完成。這些欄位不判定自然語意、不修改原文與時間，亦不取得控制或派送許可。


### 來源的角色與時間歸屬

敘述誰在何時提出、修訂或回報時，逐項綁定同一正式來源的角色與 messageRecordedAt／localMessageRecordedAt；不能拿相鄰 Assistant 答覆完成時間當成 User 提交時間。訊息原時間、原文明說的事件時間 eventOccurredAt、現在／前次交流、工具或投影生成時間分開；缺少事件時間不能以訊息時間補成外部事件發生時刻。轉換時區只用已提供的有效時區，保持同一瞬間；未知就明示，不能猜或刷新原時間。 此契約不重新寫入原時間，也不限制回答版面；只有實際陳述鐘點時才依同件來源核對。模型可見回答與正式保存仍分項驗收。

### 同源逐字引文視圖

正式呈現的 `quotationView` 將目前計畫片段及明示維持條件，連回同一正式投影已核對的 User 來源、角色、原時間、引文範圍、雜湊與計畫版本。`verbatim_source_fragment` 可依所列來源逐字引用；`assembled_formal_fragments_not_a_single_user_quote` 是多個正式片段組成的計畫內容，不能當成使用者一次說出的完整引文。視圖不產生新原話、事實、語意裁決或執行授權。

此視圖只涵蓋目前計畫及其明示保留片段，不宣稱全部歷史覆蓋。來源、範圍或版本不符，或超出視圖的有界容量時，明示不可用；完整正式投影與既有分頁仍保留。查看不刷新原時間、TTL 或控制，模型實際取得及引用是否正確仍須分別驗收。
### Hermes 型別提案的欄位回饋

Hermes 已授權當輪的 v6 `proposal` 若不符合正式工具 schema，會回 `cmcp_continuity_input_rejection`，指出同一 schema 的有界欄位路徑、錯誤種類及可得預期型別。回饋不包含輸入值、未知欄名或驗證器原始錯誤正文，也不猜測或補入來源 `ref`；宿主須依正式已讀來源修正自己的完整提案。

`sourceRead=false`、`formalProjection=false` 表示這只是輸入拒絕，尚未進行該次正式來源核對；不能當成投影、語意通過或執行許可。後續失敗嘗試仍保留當輪未完成狀態，不能拿先前成功投影掩蓋；合法提案仍送同一 SDK／Core，原有來源、角色、版本、控制與取消守護保持。舊 `proposalJson` 字串沿既有 v1 至 v6 路徑處理；其他宿主與 MCP 直接入口不因此宣稱已具備相同回饋。
### 正式來源的範圍與原文上下文

正式投影的引文是宿主選取、經正式來源核對的片段；片段結尾不是原訊息結尾，也不能用它推定原文已截斷。來源視圖另外分列原訊息範圍、正式閱讀與已組裝的模型材料範圍，並在既有容量內按來源去重提供完整短原文上下文。這些材料來自同一正式 reader；不是新 History、標準答案或額外模型判讀。

上下文超過範圍時，視圖明示不能提供，仍可沿正式 reader 分頁取得；不能裁掉後段再稱全文，也不代表原件不存在。既有投影沒有這份證據時保留未知；目前重新核對來源後可建立當下的查閱視圖，但不能因此補稱過去某輪已讀、已送達或已理解。閱讀、材料組裝、實際宿主請求與語意覆核各有證據責任。

來源角色、原時間、版本與雜湊仍由正式來源綁定。視圖不解除 OFF、Clean、撤權或保存控制，不刷新 User 原時間、Buffer 期限或派送資格。自然回答若宣稱原件不足或截斷，仍須有當輪正式覆蓋證據；結構合法與來源視圖可用都不能代替這項語意核對。
### 原文來源身分與目前讀者

共用 broker 另有經正式 Pointer、版本、雜湊及角色綁定的來源 Host／Agent／Session。這是宿主來源層的證據，不是由模型自我介紹或由來源名稱猜得。原文的 User／Assistant 角色與擷取該原文的宿主、Agent 身分須分開看。

正式 read 當頁的身分視圖將上述資料連到該頁原文及目前讀者；不修改 Core 原回執、modelContext 字串或原文雜湊。投影來源視圖只涵蓋投影使用的 refs，不能用它宣稱其他已讀來源沒有身分資料。可用的來源身分會指回當頁正式材料，無證據或超過呈現容量時明示未知／不可提供，不補上目前讀者的身分。

另一個 Agent 先前的可見 Assistant 訊息，可以作為正式來源閱讀；不因此改成目前讀者剛產生的工作紀錄、User 的決定或隱藏推理。來源身分補充只供查證，不新增保存、控制、提醒或執行授權；原生 Core 本機入口沒有 broker 身分證據時仍維持未知。

### v7：共用條件與適用對象分開保存

原文明示同一條件適用多個對象，後來只修改其中一部分時，宿主可用 `scopedPlans` 分開提供正式來源支持的對象、條件，以及每次變更的 `conditionId`／`scopeIds`。Core 將它們編成同一既有計畫契約中的獨立組合，只更新明示目標；未指定對象保留原值、原來源與原時間。此入口不猜測對象，也不因共用引文把狀態或理由傳播至其他對象。

`cmcp_project_continuity` 的 `proposal` 同時接受 v6 與 v7；v6 既有計畫保持相容。v7 的內容修改用 `replacement:{ref,quote}` 指定完整新條件，狀態、理由、明示保留及具名撤回仍各自處理。所有展開結果共用原有節點、修改、位元組及正式閱讀上限；不會因每組有新容器而增加容量。

正式結果的 `scopedPlanBindings` 與 `currentPlans[].applicability` 可對回條件、對象、原件及實際版本。CLI／slash 的既有接續狀態入口與 Desktop 詳細視窗讀取同份結果；逐字引文視圖另外提供正式原文中的對象引文。共用原句仍保留原樣，但目前條件僅作用於標明對象，不能將其中的「兩者／全部」另行擴大。

這仍是宿主宣告、正式來源核對的衍生層，**不是語意已認證或新的執行授權**。共享來源的衝突／保留覆核、OFF／Clean／撤權與 READ-ALL 不變；缺少可核對的全文或超出既有容量時明示不可提供，不拿標籤代替來源。查看、收合與刷新不修改 History、User 原時間、Buffer 期限或派送資格。
