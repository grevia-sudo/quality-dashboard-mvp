# PRD 最後補強項目（2026-05-18）

## 1. Product Lifecycle Start Definition

商品正式生命週期，應以 **A1 正式完成事件成立** 作為正式起點。匯入資料本身僅作為對帳、預建立與到貨比對用途。未完成 A1 前，不得視為正式進件完成。KPI、Google Sync 與站點流程皆以 A1 完成後為正式基準。

## 2. Google Protected Range Strategy

正式 KPI 欄位、同步欄位與站點結果欄位，需於 Google Sheet 中設置 Protected Range。一般使用者不得直接修改 KPI 欄位、工程師欄位、完成狀態欄位、Sync 狀態欄位與分類欄位。正式資料應僅允許系統回寫、系統覆蓋與系統修復。

## 3. Retry Queue Strategy

系統需保留 Retry Queue 擴充能力，後續應支援 retry 次數限制、retry 間隔設定、dead queue 與超時告警，避免 Google Sync 長時間失敗卻無法被正式追蹤。

## 4. Notification Resolution Flow

異常通知需具備責任角色、處理狀態、已處理標記、關閉時間與處理人，以避免異常長期存在、無人處理或多人重複處理。高風險異常需可追蹤誰處理、何時解除，以及是否已完成修復。

## 5. Task / Event Responsibility Definition

Station Task 表示商品於各站點的當前狀態，用途包含目前站點、待辦、流程推進與 UI 顯示。Station Event 表示商品實際發生過的歷史事件，用途包含 KPI、時間軸、Google Sync、稽核、返工追蹤與操作歷史。Task 可更新；Event 一旦建立不得修改。KPI、Google Sync、返工與歷史追溯，皆應以 Event 作為正式依據。
