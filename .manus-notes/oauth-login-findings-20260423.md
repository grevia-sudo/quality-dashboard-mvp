# OAuth 登入排查紀錄（2026-04-23）

## 已確認的程式線索

- `client/src/const.ts` 目前把 `redirectUri` 設為 `${window.location.origin}/api/oauth/callback`。
- `client/src/const.ts` 目前把 `state` 設為 `btoa(redirectUri)`，也就是把完整 callback URL 直接 base64 編碼後送出。
- `server/_core/sdk.ts` 的 `decodeState()` 直接 `atob(state)`，並把解出的值當成 token exchange 的 `redirectUri`。
- `server/_core/oauth.ts` callback 成功後固定 `302` 導回 `/`，沒有依 state 還原原始前端頁面，也沒有輸出 token exchange 失敗細節。

## 剛剛在正式網域重現到的行為

- 正式網域 `https://qualitydash-f4lqwhzd.manus.space/` 首頁可正常載入。
- 點擊「前往站點作業總覽」後，瀏覽器被導向：
  `https://manus.im/app-auth?appId=F4LQWhZd9GGdmJuBm98r2c&redirectUri=https%3A%2F%2Fqualitydash-f4lqwhzd.manus.space%2Fapi%2Foauth%2Fcallback&state=aHR0cHM6Ly9xdWFsaXR5ZGFzaC1mNGxxd2h6ZC5tYW51cy5zcGFjZS9hcGkvb2F1dGgvY2FsbGJhY2s%3D&type=signIn`
- 這表示正式網域目前確實把 published domain 當成 OAuth callback 網址使用。

## 目前高風險點

1. OAuth 平台若要求 `state` 攜帶 origin / returnPath，而不是 callback URL，本專案目前格式可能不符合預期。
2. OAuth 平台若只白名單 preview domain，則 published domain callback 在 exchange token 時可能會拿到 403。
3. callback 目前缺少更細的伺服器端錯誤日誌，無法直接看到上游回傳的 status 與 response body。
