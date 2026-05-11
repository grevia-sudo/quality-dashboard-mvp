import fs from 'node:fs';
import path from 'node:path';

const projectDir = '/home/ubuntu/quality-dashboard-mvp';
const reportPath = path.join(projectDir, 'tmp', 'purchase_sheet_reconcile_report.json');
const outputPath = path.join(projectDir, 'tmp', 'purchase_sheet_manual_review.md');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const actions = Array.isArray(report.actions) ? report.actions : [];
const rowMapping = actions.filter((item) => item.mode === 'row_mapping');
const ambiguous = actions.filter((item) => item.mode === 'ambiguous');
const exactImei = actions.filter((item) => item.mode === 'exact_imei').slice(0, 20);
const exactBoth = actions.filter((item) => item.mode === 'exact_both').slice(0, 20);

function toTable(rows, includeAfter = true) {
  if (!rows.length) return '_無資料_\n';
  const header = includeAfter
    ? '| 列號 | 動作 | 模式 | 系統商品 | 原批號 | 原序號 | 原IMEI | 對應批號 | 對應序號 | 對應IMEI | 備註 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
    : '| 列號 | 動作 | 模式 | 系統商品 | 原批號 | 原序號 | 原IMEI | 備註 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
  const body = rows.map((item) => {
    const product = item.productCode || '';
    const before = item.before || {};
    const after = item.after || {};
    const safe = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return includeAfter
      ? `| ${safe(item.rowNumber)} | ${safe(item.action)} | ${safe(item.mode)} | ${safe(product)} | ${safe(before.batchNo)} | ${safe(before.serialNumber)} | ${safe(before.imei)} | ${safe(after.batchNo)} | ${safe(after.serialNumber)} | ${safe(after.imei)} | ${safe(item.note)} |`
      : `| ${safe(item.rowNumber)} | ${safe(item.action)} | ${safe(item.mode)} | ${safe(product)} | ${safe(item.currentBatch)} | ${safe(item.currentSerial)} | ${safe(item.currentImei)} | ${safe(item.note)} |`;
  }).join('\n');
  return `${header}${body}\n`;
}

const md = `# Google 採購單重複序號/IMEI 人工確認清單

本清單根據 \`tmp/purchase_sheet_reconcile_report.json\` 產生，目的在於協助人工抽查保守版回寫結果。已完成的 Google Sheets 回寫策略為：高信心 identity 對應才自動改 D/E/F；僅能依 row 映射判定的案例不自動改值，只在 AE 欄留下提醒。

| 類別 | 筆數 |
| --- | ---: |
| duplicateRelatedRows | ${report.summary?.duplicateRelatedRows ?? 0} |
| resolvedBySystem | ${report.summary?.resolvedBySystem ?? 0} |
| annotatedOnly | ${report.summary?.annotatedOnly ?? 0} |
| row_mapping | ${rowMapping.length} |
| ambiguous | ${ambiguous.length} |

## 一、最高優先人工確認：row_mapping 案例

這些列目前**沒有自動改 D/E/F**，只在 AE 欄寫入「row 映射可疑，暫不自動改值(row_mapping)」。若要進一步清理，應由人工對照原單據或現場紀錄確認。

${toTable(rowMapping.slice(0, 80))}

## 二、無法唯一對應：ambiguous 案例

這些列目前只在 AE 欄寫入「無法唯一對應系統商品，請人工確認」，未自動改值。

${toTable(ambiguous.slice(0, 80), false)}

## 三、建議抽樣複核：exact_imei 案例樣本

以下列屬於只靠 IMEI 唯一命中的自動對齊樣本，可由使用者優先抽查幾列，確認保守版邏輯符合現場預期。

${toTable(exactImei)}

## 四、建議抽樣複核：exact_both 案例樣本

以下列同時命中序號與 IMEI，可作為高信心樣本抽查。

${toTable(exactBoth)}
`;

fs.writeFileSync(outputPath, md);
console.log(outputPath);
