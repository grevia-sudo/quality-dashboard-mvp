# Google Drive 照片同步通道紀錄

## 結論

E 站照片補同步目前 **正式可用的 API 通道** 為：使用 `gws` CLI 代表已授權的使用者 OAuth 身分上傳至 Google Drive 目標資料夾，再以既有服務帳號存取 Google Sheets API 回寫採購單照片連結。

## 驗證結果

### 1. 服務帳號可讀取 Google Sheets，但不適合作為此資料夾的照片上傳通道

本次以服務帳號直接呼叫 Google Drive 上傳時，批次腳本回傳的錯誤為：

> Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation instead.

這表示目前照片資料夾的實際可持續上傳方式，不應再依賴單純的服務帳號上傳流程。

### 2. `gws` OAuth 通道可正常存取目標資料夾並建立檔案

已驗證下列操作可成功：

- 讀取目標資料夾 `1PPdt4swkmSav8G6k2Dfpk55OBPJk4srW`
- 確認資料夾具備 `canAddChildren: true`
- 成功上傳測試檔 `01900000001-1-probe.jpg`
- 成功完成 E 站照片批次補同步

## 建議維運方式

後續若再遇到 E 站照片需要補同步，建議遵循以下方式：

| 項目 | 建議做法 |
| --- | --- |
| Google Drive 照片上傳 | 優先使用 `gws drive files create` |
| 採購單照片連結回寫 | 沿用既有 Google Sheets API 寫入流程 |
| 補同步來源 | 若任務 metadata 中仍保有 `/manus-storage/` 備援照片路徑，可直接重新下載後上傳 |
| 例外排查 | 若採購單缺列，先補建 A:F 基本資料列，再回寫 AC:AD 照片連結 |

## 本次補同步相關檔案

- 補同步腳本：`scripts/resync-e-station-fallback.ts`
- 批次結果：`e-station-photo-resync-result.json`

