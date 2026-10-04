# 本機查證 Trace v0.1

這個唯讀入口按**精確 work ID**串起既有工作回執、來源登錄與正式 History 解析、候選／閱讀結果，以及綁定該工作的模型 attempt。它只顯示可取得的紀錄，不重新查詢候選、不呼叫模型、不更新使用者時間或 Buffer 期限，也不推測模型內部思考。

```powershell
node scripts/cmcp-evidence-trace.mjs --workspace <持久工作區> --config <工作區內現有正常設定檔> --work-id <精確 work ID>
node scripts/cmcp-evidence-trace.mjs --help
```

預設只輸出 metadata，包括本次來源 Pointer、登錄／版本核對、User／Assistant 角色與原時間、正式閱讀覆蓋、模型 request 各欄位位元組數、transport 狀態與可得用量；不輸出原文或完整 request／response。需要檢查某一筆保留下來的原始輸入輸出時，明確指定單一 attempt：

若正常回答回執含 `lookupReceipt.requestId`，trace 只沿該 ID 及授權 scope 讀既有 `cmcp_history_query_v1` journal，不按時間猜另一個查詢。`historyQuery` 分開列出凍結來源集合與 hash、目前至多八筆 History／catalog 核對、各頁原文讀取範圍和累計覆蓋、模型分類結果、最後回答 request 實際包含的來源 alias。`frozen.uncheckedCurrentSources` 是尚未對現存來源重核的筆數；`reading.coverage.complete` 僅表示凍結集合的正式分頁完成，不代表語義查證充分，後者仍要看 `terminal.aggregateStatus`／`lookupReceiptStatus`。分類只是當時模型輸出，不是獨立證實的事實。alias 對上須同時具備保留 request、`fetchStarted` 與完整回應，否則標為未確立。

這條連結只檢查原本那份閱讀票券與來源版本，不擴張票券、不另取新來源。超過八筆來源時仍可列出凍結集合總數與未核數，不把未核對的來源說成已驗。當前控制不允許回查時，不讀來源或查詢 journal，也不顯示歷史查詢脈絡。

```powershell
node scripts/cmcp-evidence-trace.mjs --workspace <持久工作區> --config <設定檔> --work-id <work ID> --attempt <序號> --include-bodies
```

`--include-bodies` 會將私人原文輸出到目前終端；只用於已授權的本機核對，不要貼入公開報告。現行 OFF／Clean／History recall 關閉，或舊工作已跨越 Buffer Clear 邊界時，不檢查來源或展示讀取結果；保存控制未同時允許 User 與 Assistant 時，也不展示原始 request／response。若原始 body 本來未保存，結果標 `not_retained`，不可從 hash 猜出內容。

`started` 只代表 attempt 已記帳，**不代表已 POST**；`fetchStarted` 只證明本機進入傳送邊界，`responseComplete`／HTTP／回執另列。工作失敗、取消或尚無 receipt 都會如實呈現，不替它補成成功。來源解析上限為每次八筆；顯示的 `referencedPointerCount` 超出 `checked` 時，表示本次 trace 未核對其餘來源。登錄清冊未完整時，未找到不可改稱全歷史不存在。

這是單一工作證據視圖，不是完整帳號查證或新的閱讀票券。正式 READ／READ-ALL、分批查證和保存仍使用原有正常入口。沒有精確 work ID 的同一 ledger attempt 只列在 `unattributedLedgerStarts`，與本工作關係標 `unknown`，不以時間接近猜測。獨立 budget dependency 的 attempt ledger 目前無法只憑一般設定檔定位；此時 `attemptCoverage` 不應解讀為零模型呼叫，須用原授權工作設定核對。

## 本機 M1 原稿／修訂回查補充（2026-09-29）

正常對话引用既有原稿或要求修改時，材料需求判讀可接正式 reader 的原稿導航；這仍是相同 History／來源清冊。較大的已界定集合分成最多四批、每批至多32筆定位資料；多批命中才合併候選作最後選取。每批輸入至多10,500 bytes，全集合至多128筆、最後至多8個原件，正式回答投影至多8,192 bytes。不是將每批都當新問題，也不替每批重置閱讀／授權預算。

工作回執 `lookupReceipt.materialSelection` 保留本次模型呼叫數、導航批數及成功選取階段；`completedSelectionStages` 是邏輯階段數，不是包括取消／失敗在內的付費POST總數。實際用量仍查正式ledger。跨批 `globalSourceRefs` 只讓既有reply關係可核對，不授權直接選取本批未提供的原文。

`navigationOnly` 表示正式原文閱讀，而未作逐來源事實分類；即使來源全讀完，也不能把「分類尚未完成」改稱原文不存在或集合未凍結。已讀、定位片段、最後完整原文投影與語意結論須分開核對。大於限額仍會明示不足；原History不刪、READ-ALL及完整計數不改為top-k。

這是尚未公開發布的本機施工版接線；詳細案例、原失敗及成本依管理根本次M1報告。一般操作沿現有Playground，使用者不必整理答案卡或填Pointer。原角色、時間、Clear／OFF／停止保存、取消與恢復仍有效。

### 2026-09-29：選取核驗與結果鏈的觀測

一般對話的原稿導航會沿正式 reader 讀取已凍結來源，再以每批最多32來源、最多4批及一次候選合併選取，最後答案仍受8來源／8192bytes投影限制。批次中錯選可能由合併排除；不能把最終選對寫成每批模型都正確。

v30 一般回查的 caller 只傳本次工作／generation 守護，選取 helper 自行執行既有正式來源核驗；移除的是同一callback內的重複第二次核驗，並未略過發送前後的來源或取消核對。答案最後的來源核驗仍保留。實際時間、來源與保存結果分開觀察，模型回覆完成不代表工作已保存成功。

同一次 provider attempt 可以先記錄 completed，再因返回後的工作期限記錄 cancelled。按正式請求身分及 journal sequence 保留全部觀測；POST只計一次，終態取最後正式觀測，有唯一可得usage仍保留，衝突則明示未知。施工工具只處理時間／用量欄位，不讀取或呈現模型內部思考。
