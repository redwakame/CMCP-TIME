# Hermes 外部依賴與重建

1. 使用 Python 3.11 至 3.13 的獨立虛擬環境；本輪實跑 3.12.14。不要改全域 Python 或既有 Hermes profile。
2. 取得官方 `https://github.com/NousResearch/hermes-agent` commit `f97608f178d1ffeca59860195ab7da295f7c8e5f`。本輪 ZIP 為 `https://api.github.com/repos/NousResearch/hermes-agent/zipball/f97608f178d1ffeca59860195ab7da295f7c8e5f` 對應來源；實際留存封裝的 bytes／SHA-256 見本單 archive-receipt。GitHub ZIP 封裝可能因下載入口不同而不同，核對 commit 與成員內容，不僅比較不同 URL 的整包 hash。
3. 先依 `requirements-tested.txt` 在獨立虛擬環境安裝本輪核對版本，再從上述官方來源執行 `python -m pip install --no-deps --no-build-isolation -e <official-source>`。官方此版一般 wheel 安裝未成功；錯誤原件保留，因此本輪採官方原始碼的 editable 安裝，不能稱一般 wheel 已通過。
4. Windows 原生檔案／終端工具需要 Git Bash。本輪額外依賴為官方 Git for Windows `2.56.0.windows.1` 的可攜封裝，SHA-256 `eceb5e061aa90df2f69ddd3e90f0030e1b8037a7829934bc40e4be1caa1accc1`，59,958,024 bytes。以既有解壓工具展開，沒有執行下載 EXE、系統安裝或改全域 PATH。自行準備等價已核對 Git Bash 時仍應定點驗原生工具。
5. CMCP Node 相依由自身 npm shrinkwrap 固定；不要把 Hermes 第三方套件或憑證放入 CMCP 產品 ZIP。首次安裝可能需要網路下載公開依賴；本單模型路線仍只有已授權 DeepSeek。

重跑離線控制測試：

```text
python -m unittest discover -s <產品來源>/adapters/hermes/tests -v
node --test <產品來源>/adapters/hermes/bridge.test.mjs <產品來源>/adapters/hermes/peer.test.mjs <產品來源>/adapters/hermes/cli.test.mjs
```

測試使用 `CMCP_TEST_OUTPUT_ROOT` 指定合成輸出位置；不存在時建立，不回收既有資料。Python 快取可指定專案內 `PYTHONPYCACHEPREFIX`。真模型回合不能由離線 PASS 推論；須另明示授權並記錄官方事件。

`requirements-tested.txt` 只記 PyPI 依賴的核對版本，Hermes 本體由上述官方 commit 決定。`pip freeze` 對巢狀 editable 路徑可能誤辨識外層工程 Git remote，因此不能使用該誤推 remote 重建 Hermes。
