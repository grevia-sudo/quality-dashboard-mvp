# E 站拍照與 Google 上傳可行性查證筆記

## 行動裝置拍照
- MDN 說明 `input type="file"` 搭配 `accept="image/*"` 與 `capture` 可在支援的裝置上要求拍攝新照片，`capture` 可指定 `user` 或 `environment` 相機方向。
- MDN 也說明此行為在行動裝置上效果較佳，桌機通常仍會顯示一般檔案選擇器，因此此方案適合使用者描述的手持裝置情境。

## Google Drive 上傳
- Google Drive API 文件說明可透過 `files.create` 上傳檔案，支援 simple、multipart、resumable 三種模式。
- 對於可能來自手持裝置的照片，上傳中斷機率相對較高，因此較建議由後端採 resumable upload，或在檔案不大時採 multipart upload。
- 目前專案已存在 `GOOGLE_SERVICE_ACCOUNT_JSON` 相關 helper，可推論後端能沿用既有服務帳號 JWT 換 token 的模式，再把 scope 擴充到 Drive 寫入權限。
