import { createSign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { products, stationTasks } from '../drizzle/schema';
import { getDb } from '../server/db';

const execFileAsync = promisify(execFile);
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DRIVE_FOLDER_ID = '0AGU-A31NmApoUk9PVA';
const GWS_BIN = '/home/ubuntu/.local/share/pnpm/bin/gws';
const PURCHASE_SHEET_SPREADSHEET_ID = '15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y';
const PURCHASE_SHEET_NAME = '採購單';
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const TMP_BASE_DIR = '/home/ubuntu/quality-dashboard-mvp/tmp/e-station-resync';
const TMP_DIR = `${TMP_BASE_DIR}/${process.pid}-${Date.now()}`;
const OUTPUT_PATH = '/home/ubuntu/quality-dashboard-mvp/e-station-photo-resync-result.json';

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type DbRow = {
  taskId: number;
  productId: number;
  batchNo: string | null;
  serialNumber: string | null;
  imei: string | null;
  sheetRowNumber: number | null;
  metadata: Record<string, unknown> | null;
};

type PendingPhotoUpload = {
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
};

type PhotoSource =
  | { kind: 'storage'; path: string }
  | { kind: 'data_url'; dataUrl: string; mimeType?: string };

function base64UrlEncode(input: string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getCredentials(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  }
  const credentials = JSON.parse(raw) as ServiceAccountCredentials;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key');
  }
  return credentials;
}

async function getSheetsAccessToken() {
  const credentials = getCredentials();
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedPayload = base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope: SHEETS_SCOPE,
    aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer
    .sign(credentials.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });

  const result = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || 'token exchange failed');
  }
  return result.access_token;
}

function buildFileNameBase(batchNo: string | null) {
  return String(batchNo ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\\/:*?"<>|#%{}]+/g, '-');
}

function ensurePhotoPath(value: unknown, label: string) {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/manus-storage/')) {
    throw new Error(`${label} 缺少可讀取的備援照片路徑`);
  }
  return path;
}

function parsePendingPhotoUpload(value: unknown): PendingPhotoUpload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const photo = value as Record<string, unknown>;
  const dataUrl = String(photo.dataUrl ?? '').trim();
  if (!dataUrl.startsWith('data:')) {
    return null;
  }
  return {
    fileName: typeof photo.fileName === 'string' ? photo.fileName : undefined,
    mimeType: typeof photo.mimeType === 'string' ? photo.mimeType : undefined,
    dataUrl,
  };
}

function resolvePhotoSource(metadata: Record<string, unknown> | null, side: 'front' | 'back') {
  const urlKey = side === 'front' ? 'eFrontPhotoUrl' : 'eBackPhotoUrl';
  const label = side === 'front' ? '正面照片' : '反面照片';
  const directPath = String(metadata?.[urlKey] ?? '').trim();
  if (directPath.startsWith('/manus-storage/')) {
    return { kind: 'storage', path: directPath } as PhotoSource;
  }

  const pendingUploads = metadata?.ePhotoPendingUploads;
  if (pendingUploads && typeof pendingUploads === 'object') {
    const pendingPhoto = parsePendingPhotoUpload((pendingUploads as Record<string, unknown>)[side]);
    if (pendingPhoto?.dataUrl) {
      return {
        kind: 'data_url',
        dataUrl: pendingPhoto.dataUrl,
        mimeType: pendingPhoto.mimeType,
      } as PhotoSource;
    }
  }

  throw new Error(`${label} 缺少可用的備援照片來源`);
}

async function writePhotoSourceToFile(source: PhotoSource, destinationPath: string) {
  if (source.kind === 'storage') {
    const response = await fetch(new URL(source.path, APP_BASE_URL), { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`讀取備援照片失敗：${source.path} (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await writeFile(destinationPath, Buffer.from(arrayBuffer));
    return;
  }

  const commaIndex = source.dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('dataUrl 格式錯誤，無法還原照片');
  }
  const encoded = source.dataUrl.slice(commaIndex + 1);
  await writeFile(destinationPath, Buffer.from(encoded, 'base64'));
}

async function uploadPhotoToDriveWithGws(localPath: string, fileName: string) {
  const { stdout } = await execFileAsync(GWS_BIN, [
    'drive',
    'files',
    'create',
    '--upload',
    localPath,
    '--json',
    JSON.stringify({
      name: fileName,
      parents: [DRIVE_FOLDER_ID],
    }),
    '--params',
    JSON.stringify({
      supportsAllDrives: true,
    }),
  ], {
    cwd: '/home/ubuntu/quality-dashboard-mvp',
    maxBuffer: 10 * 1024 * 1024,
  });

  const result = JSON.parse(stdout) as { id?: string; webViewLink?: string; webContentLink?: string; name?: string };
  if (!result.id) {
    throw new Error(`gws 上傳失敗：${stdout}`);
  }
  return result.webViewLink ?? result.webContentLink ?? `https://drive.google.com/file/d/${result.id}/view`;
}

function matchesPurchaseSheetIdentity(row: string[] | undefined, identity: { batchNo?: string | null; serialNumber?: string | null; imei?: string | null }) {
  const rowBatchNo = String(row?.[3] ?? '').trim();
  const rowSerialNumber = String(row?.[4] ?? '').trim();
  const rowImei = String(row?.[5] ?? '').trim();
  const batchNo = String(identity.batchNo ?? '').trim();
  const serialNumber = String(identity.serialNumber ?? '').trim();
  const imei = String(identity.imei ?? '').trim();

  return Boolean(
    (imei && rowImei && imei === rowImei)
    || (serialNumber && rowSerialNumber && serialNumber === rowSerialNumber)
    || (batchNo && rowBatchNo && batchNo === rowBatchNo)
  );
}

async function resolvePurchaseSheetRowNumber(sheetsAccessToken: string, identity: { sheetRowNumber?: number | null; batchNo?: string | null; serialNumber?: string | null; imei?: string | null }) {
  if (identity.sheetRowNumber && identity.sheetRowNumber > 1) {
    return identity.sheetRowNumber;
  }

  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PURCHASE_SHEET_SPREADSHEET_ID}/values/${encodeURIComponent(`${PURCHASE_SHEET_NAME}!A:F`)}`, {
    headers: { Authorization: `Bearer ${sheetsAccessToken}` },
  });
  const result = await response.json() as { values?: string[][]; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(result.error?.message || '讀取採購單資料列失敗');
  }

  const rowIndex = (result.values ?? []).findIndex((row, index) => index > 0 && matchesPurchaseSheetIdentity(row, identity));
  if (rowIndex < 0) {
    throw new Error('找不到對應的採購單資料列，無法回寫 E 站照片連結');
  }
  return rowIndex + 1;
}

async function writePhotoLinksToSheet(sheetsAccessToken: string, input: { sheetRowNumber?: number | null; batchNo?: string | null; serialNumber?: string | null; imei?: string | null; frontPhotoUrl: string; backPhotoUrl: string; }) {
  const rowNumber = await resolvePurchaseSheetRowNumber(sheetsAccessToken, input);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PURCHASE_SHEET_SPREADSHEET_ID}/values/${encodeURIComponent(`${PURCHASE_SHEET_NAME}!AC${rowNumber}:AD${rowNumber}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${sheetsAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[input.frontPhotoUrl, input.backPhotoUrl]] }),
  });
  const result = await response.json() as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(result.error?.message || '回寫 E 站照片連結到採購單失敗');
  }
  return rowNumber;
}

function shouldTarget(metadata: Record<string, unknown> | null) {
  const status = String(metadata?.ePhotoSyncStatus ?? '');
  if (status !== 'storage_fallback' && status !== 'background_failed') {
    return false;
  }

  try {
    resolvePhotoSource(metadata, 'front');
    resolvePhotoSource(metadata, 'back');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error('Database unavailable');
  }

  await mkdir(TMP_DIR, { recursive: true });

  const rows = await db
    .select({
      taskId: stationTasks.id,
      productId: stationTasks.productId,
      metadata: stationTasks.metadata,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      sheetRowNumber: products.sheetRowNumber,
    })
    .from(stationTasks)
    .innerJoin(products, eq(products.id, stationTasks.productId))
    .where(and(
      eq(stationTasks.stationCode, 'E'),
      eq(stationTasks.taskStatus, 'completed'),
    ));

  const targets = rows.filter((row) => shouldTarget((row.metadata ?? null) as Record<string, unknown> | null)) as DbRow[];
  const sheetsAccessToken = await getSheetsAccessToken();
  const summary: Array<Record<string, unknown>> = [];

  for (const row of targets) {
    const metadata = { ...((row.metadata ?? {}) as Record<string, unknown>) };
    const attempts = Number(metadata.ePhotoSyncAttempts ?? 0);
    const batchNoBase = buildFileNameBase(row.batchNo);
    const frontTempPath = `${TMP_DIR}/${row.taskId}-front.jpg`;
    const backTempPath = `${TMP_DIR}/${row.taskId}-back.jpg`;

    try {
      if (!batchNoBase) {
        throw new Error('此商品缺少商品批號，無法建立 E 站照片檔名');
      }

      const frontSource = resolvePhotoSource(metadata, 'front');
      const backSource = resolvePhotoSource(metadata, 'back');
      await writePhotoSourceToFile(frontSource, frontTempPath);
      await writePhotoSourceToFile(backSource, backTempPath);

      const frontDriveUrl = await uploadPhotoToDriveWithGws(frontTempPath, `${batchNoBase}-1.jpg`);
      const backDriveUrl = await uploadPhotoToDriveWithGws(backTempPath, `${batchNoBase}-2.jpg`);

      try {
        const rowNumber = await writePhotoLinksToSheet(sheetsAccessToken, {
          sheetRowNumber: row.sheetRowNumber,
          batchNo: row.batchNo,
          serialNumber: row.serialNumber,
          imei: row.imei,
          frontPhotoUrl: frontDriveUrl,
          backPhotoUrl: backDriveUrl,
        });

        metadata.eFrontPhotoUrl = frontDriveUrl;
        metadata.eBackPhotoUrl = backDriveUrl;
        metadata.ePhotoSyncStatus = 'background_completed';
        metadata.ePhotoSyncMessage = 'E 站照片已透過 API 補同步到 Google Drive，採購單連結已回寫';
        metadata.ePhotoSyncAttempts = attempts + 1;
        delete metadata.ePhotoPendingUploads;

        await db
          .update(stationTasks)
          .set({ metadata, updatedAt: new Date() })
          .where(eq(stationTasks.id, row.taskId));

        summary.push({
          taskId: row.taskId,
          batchNo: row.batchNo,
          status: 'background_completed',
          sheetRowNumber: rowNumber,
          frontDriveUrl,
          backDriveUrl,
        });
      } catch (sheetError) {
        metadata.eFrontPhotoUrl = frontDriveUrl;
        metadata.eBackPhotoUrl = backDriveUrl;
        metadata.ePhotoSyncStatus = 'sheet_write_failed';
        metadata.ePhotoSyncMessage = `E 站照片已補上傳到 Google Drive，但採購單回寫失敗：${sheetError instanceof Error ? sheetError.message : String(sheetError)}`;
        metadata.ePhotoSyncAttempts = attempts + 1;
        delete metadata.ePhotoPendingUploads;

        await db
          .update(stationTasks)
          .set({ metadata, updatedAt: new Date() })
          .where(eq(stationTasks.id, row.taskId));

        summary.push({
          taskId: row.taskId,
          batchNo: row.batchNo,
          status: 'sheet_write_failed',
          error: sheetError instanceof Error ? sheetError.message : String(sheetError),
          frontDriveUrl,
          backDriveUrl,
        });
      }
    } catch (error) {
      metadata.ePhotoSyncStatus = 'background_failed';
      metadata.ePhotoSyncMessage = `E 站照片 API 補同步失敗：${error instanceof Error ? error.message : String(error)}`;
      metadata.ePhotoSyncAttempts = attempts + 1;

      await db
        .update(stationTasks)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(stationTasks.id, row.taskId));

      summary.push({
        taskId: row.taskId,
        batchNo: row.batchNo,
        status: 'background_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(frontTempPath, { force: true });
      await rm(backTempPath, { force: true });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    appBaseUrl: APP_BASE_URL,
    targetCount: targets.length,
    successCount: summary.filter((item) => item.status === 'background_completed').length,
    sheetWriteFailedCount: summary.filter((item) => item.status === 'sheet_write_failed').length,
    failedCount: summary.filter((item) => item.status === 'background_failed').length,
    items: summary,
  };

  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

await main();
