import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const PROJECT_DIR = '/home/ubuntu/quality-dashboard-mvp';
const OUTPUT_PATH = path.join(PROJECT_DIR, 'tmp', 'manual_duplicate_identity_analysis_batch2.json');

const keys = [
  'C6KCG1M6N73D','C7CZ71H3N73D','C8PXM47DKXK9','DNPZ39VWKXK6','DX3GN459N739','F4HCHDKQN735','F7092WY6N0','F71XR1JSKXKH','G6TDF21N0F11','G6TDH2EB0F0V','G6TDV9BA0D53','G6TF21Q10F11','GG9T9D2YWF','HKCWN6216Y','KH4Q3766WJ','LK4G6N9GJK','MGJTHX0XHK','MGXJR2HVQG','NM70WVMVTW','NMPVGKQHHD','PG45KX79C4','PXX03NXTG7','QTP2656QG5','R2XLT49XX1','R9D2F2JV41','W47HW7D2W4','XQNQQHW9N2','YWY425C2T7','10AFAS1TDU002GL','TCG6B6S86PLRKB5P','580050860603','a5c26e40c336','c6e3925e','CY9PLBFQ89AEQOIJ'
];

function normalize(value) {
  const str = String(value ?? '').trim();
  return str === 'NULL' ? '' : str;
}

function filledScore(product) {
  const fields = [
    normalize(product.batchNo),
    normalize(product.poNumber),
    normalize(product.vendorName),
    normalize(product.importedCategoryName),
    normalize(product.productName),
    normalize(product.productStatus),
    normalize(product.stationCode),
  ];
  return fields.filter(Boolean).length;
}

function comparableProfile(product) {
  return JSON.stringify({
    batchNo: normalize(product.batchNo),
    poNumber: normalize(product.poNumber),
    vendorName: normalize(product.vendorName),
    importedCategoryName: normalize(product.importedCategoryName),
    productName: normalize(product.productName),
    productStatus: normalize(product.productStatus),
    stationCode: normalize(product.stationCode),
  });
}

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const quoted = keys.map((v) => conn.escape(v)).join(',');
const [rows] = await conn.query(`
  SELECT id, productCode, poNumber, vendorName, importedCategoryName, batchNo, serialNumber, imei, productName, productStatus, stationCode, updatedAt
  FROM products
  WHERE archivedAt IS NULL
    AND (serialNumber IN (${quoted}) OR imei IN (${quoted}))
  ORDER BY COALESCE(NULLIF(serialNumber,''), NULLIF(imei,'')), updatedAt DESC, id DESC
`);
await conn.end();

const grouped = new Map();
for (const row of rows) {
  const serial = normalize(row.serialNumber);
  const imei = normalize(row.imei);
  const matches = keys.filter((key) => key === serial || key === imei);
  for (const key of matches) {
    const list = grouped.get(key) || [];
    list.push({
      ...row,
      batchNo: normalize(row.batchNo),
      poNumber: normalize(row.poNumber),
      vendorName: normalize(row.vendorName),
      importedCategoryName: normalize(row.importedCategoryName),
      serialNumber: serial,
      imei,
      productName: normalize(row.productName),
      productStatus: normalize(row.productStatus),
      stationCode: normalize(row.stationCode),
      score: filledScore(row),
      profile: comparableProfile(row),
    });
    grouped.set(key, list);
  }
}

const results = [];
for (const key of keys) {
  const candidates = grouped.get(key) || [];
  const uniqueById = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueById.push(item);
  }
  uniqueById.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = new Date(a.updatedAt).getTime();
    const bt = new Date(b.updatedAt).getTime();
    if (bt !== at) return bt - at;
    return Number(b.id) - Number(a.id);
  });

  let decision = 'manual_review';
  let chosenId = null;
  let reason = '兩筆以上候選皆有資料，需人工確認';

  if (uniqueById.length <= 1) {
    decision = uniqueById.length === 1 ? 'single_candidate' : 'no_candidate';
    chosenId = uniqueById[0]?.id ?? null;
    reason = uniqueById.length === 1 ? '系統僅一筆候選' : '系統查無候選';
  } else {
    const top = uniqueById[0];
    const second = uniqueById[1];
    if (top.score === 0 && second.score === 0) {
      decision = 'keep_either_blank';
      chosenId = top.id;
      reason = '候選資料皆空白，依規則保留任一筆';
    } else if (top.score > second.score) {
      decision = 'keep_more_complete';
      chosenId = top.id;
      reason = '僅一筆資料較完整，依規則保留有資料者';
    } else if (top.score === second.score) {
      if (top.profile === second.profile) {
        decision = 'keep_either_same_data';
        chosenId = top.id;
        reason = '候選資料內容相同，保留任一筆即可';
      } else {
        decision = 'manual_review';
        chosenId = null;
        reason = '兩筆候選皆有資料且內容不同，需人工確認';
      }
    }
  }

  results.push({
    key,
    candidateCount: uniqueById.length,
    decision,
    chosenId,
    reason,
    candidates: uniqueById.map((item) => ({
      id: item.id,
      productCode: item.productCode,
      poNumber: item.poNumber,
      vendorName: item.vendorName,
      importedCategoryName: item.importedCategoryName,
      batchNo: item.batchNo,
      serialNumber: item.serialNumber,
      imei: item.imei,
      productName: item.productName,
      productStatus: item.productStatus,
      stationCode: item.stationCode,
      updatedAt: item.updatedAt,
      score: item.score,
    })),
  });
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
console.log(JSON.stringify({ outputPath: OUTPUT_PATH, totalKeys: keys.length, results: results.length }, null, 2));
