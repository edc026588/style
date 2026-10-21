# 潤稿台

一頁式的文字潤飾工具，有四種模式：

| 模式 | 做什麼 |
| --- | --- |
| 潤飾繁中 | 把中文潤飾成通順的臺灣繁體中文：修正錯字、「的／地／得」、歐化句、標點；夾雜的簡體字或大陸用語會改成臺灣用法。 |
| 轉簡體 | 繁體轉簡體，並把用語換成大陸說法（軟體 → 软件、影片 → 视频、網路 → 网络），引號改成 “”。 |
| 中英互換 | 依原文自動判斷方向：中文翻成自然的英文（可選美式或英式拼寫），英文翻成臺灣繁體中文。 |
| 原語潤飾 | 任何語言都用原本的語言潤飾，不翻譯。 |

每種模式都可以調整語氣（保持原文、正式、輕鬆、商務、學術）、修改幅度、速度，也可以加上補充指示。結果會附上說明；「潤飾繁中」與「原語潤飾」可以切換到「標示修改」，用紅筆標出刪除與新增的文字，並顯示比原稿多或少幾個字。

- 同一段文字再按一次，會產生新的版本（最多 5 版），在結果右上角用 ‹ › 切換比較。
- 把 `.txt` 或 `.md` 檔拖進原稿就能載入；清除、載入或「以此為新稿」之後都可以按「復原」。
- 貼錯模式時（例如在「潤飾繁中」貼了英文），原稿下方會建議改用合適的模式。
- 快捷鍵：`⌘/Ctrl + Enter` 送出，`Esc` 停止，`⌘/Ctrl + 1–4` 切換模式。

## 三種用法

| | 網頁版 | 桌面版 | claude.ai Artifact |
| --- | --- | --- | --- |
| 在哪裡 | https://edc026588.github.io/language-polish/ | [Releases](https://github.com/edc026588/language-polish/releases) 下載 | 你的 claude.ai 帳號 |
| 需要 | Anthropic API 金鑰 | Anthropic API 金鑰 | Claude 帳號，不需金鑰 |
| 費用 | 依 API 用量計費 | 依 API 用量計費 | 算在 Claude 方案用量內 |

網頁版與桌面版第一次使用時，按右上角「設定」貼上 [Anthropic API 金鑰](https://console.anthropic.com/settings/keys)。金鑰只存在你自己的瀏覽器或電腦上，直接傳送到 `api.anthropic.com`，使用 Claude Opus 5.5。

### 把網頁版安裝成 App

- **Chrome／Edge（Mac、Windows）**：網址列右側的「安裝」圖示 → 安裝。之後會有自己的視窗與 Dock／工作列圖示。
- **Safari（Mac）**：檔案 → 加入 Dock。
- **iPhone／iPad**：Safari 分享 → 加入主畫面。
- **Android**：Chrome 選單 → 安裝應用程式。

安裝後沒有網路也能開啟（看紀錄、整理草稿），但潤飾與翻譯仍需要連線。

### 桌面版下載

| 系統 | 檔案 |
| --- | --- |
| Mac（Apple 晶片 M1–M4） | `LanguagePolish-版本-mac-arm64.zip` |
| Mac（Intel） | `LanguagePolish-版本-mac-x64.zip` |
| Windows | `LanguagePolish-版本-windows-setup.exe`（安裝版）或 `-windows-portable.exe`（免安裝） |
| Linux | `LanguagePolish-版本-linux-x86_64.AppImage` |

這些程式沒有向 Apple／Microsoft 購買簽章，第一次開啟會跳出警告：

- **Mac**：解壓縮後把 `LanguagePolish` 拖到「應用程式」（打開後名稱顯示為「潤稿台」）。第一次打開若顯示「無法驗證開發者」，到「系統設定 → 隱私權與安全性」，在下方按「強制打開」（或「仍要打開」）。也可以在終端機執行 `xattr -dr com.apple.quarantine /Applications/LanguagePolish.app`。
- **Windows**：SmartScreen 顯示「Windows 已保護您的電腦」時，按「其他資訊 → 仍要執行」。

## 發佈與開發

- **網頁版**：推送到 `main` 後，`.github/workflows/web.yml` 會自動部署到 GitHub Pages。第一次需要在 Settings → Pages → Build and deployment 把 Source 設為 **GitHub Actions**。
- **桌面版**：把 `desktop/package.json` 的 `version` 改成新版號，然後推送同名標籤（例如 `git tag v1.0.1 && git push origin v1.0.1`）。`.github/workflows/desktop.yml` 會在 macOS、Windows、Linux 上打包，並把檔案附到同名的 Release。
- **本機執行桌面版**：`cd desktop && npm install && npm start`。

## 檔案

```
index.html              整個 App（網頁版、桌面版、Artifact 共用同一頁）
manifest.webmanifest    安裝成 App 用的資訊
sw.js                   離線快取
icons/                  App 圖示
desktop/                Electron 桌面版（main.js、打包設定、圖示）
.github/workflows/      自動部署網頁版、自動打包桌面版
```
