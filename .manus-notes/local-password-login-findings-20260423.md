# 本地帳密登入改造重點

- 已將前端未登入導向由 OAuth 改為 `/login?next=...`。
- 已新增 `client/src/pages/LoginPage.tsx`，使用 `trpc.auth.login` 提交帳號與密碼。
- 已在 `server/routers.ts` 新增 public `auth.login` mutation，成功後沿用原本 session cookie。
- 已在 `drizzle/schema.ts` 的 `users` 表加入 `username` 與 `passwordHash` 欄位，且 `pnpm db:push` 成功。
- 使用者指定的初始帳號為 `Kiddliao`，角色為 `admin`，密碼已在 `server/_core/sdk.ts` 內用本地雜湊方式建立 bootstrap 帳號。
- 本輪登入 500 的根因不是帳密邏輯，而是 `server/db.ts` 原本未啟用 SSL，TiDB serverless 回覆：`Connections using insecure transport are prohibited`。
- 已在 `server/db.ts` 補上 `ssl: { rejectUnauthorized: false }` 後重啟服務。
- `webdev_check_status` 在重啟後顯示開發服務健康，並能載入管理後台畫面，表示 session/資料庫查詢已恢復可用。
- 依先前限制，本輪僅新增測試檔 `server/auth.password-login.test.ts`，未執行 vitest、npm test 或 tsc。

## 成功驗證

已用 curl 直接呼叫 preview 網域的 `auth.login` 與 `auth.me`：

| 驗證項目 | 結果 |
| --- | --- |
| `auth.login` | 回傳 `success: true`，並建立 `local:Kiddliao` 的 session |
| `auth.me` | 成功讀到 `username: Kiddliao`、`role: admin` |

這代表本地帳密登入主流程已可正常建立 cookie session，且後端能用同一份 session 讀回目前使用者。
