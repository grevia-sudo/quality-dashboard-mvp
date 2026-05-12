import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8",
);
const stationPageSource = readFileSync(
  new URL("../client/src/pages/StationPage.tsx", import.meta.url),
  "utf8",
);
const routersSource = readFileSync(
  new URL("./routers.ts", import.meta.url),
  "utf8",
);
const dbSource = readFileSync(
  new URL("./db.ts", import.meta.url),
  "utf8",
);

describe("E 站照片上傳 source coverage", () => {
  it("adds front and back camera capture inputs on the E station page", () => {
    expect(stationPageSource).toContain('key: "eFrontPhoto" as const');
    expect(stationPageSource).toContain('key: "eBackPhoto" as const');
    expect(stationPageSource).toContain('capture="environment"');
    expect(stationPageSource).toContain('請先拍攝正面與反面照片，再完成 E 站抹除');
    expect(stationPageSource).toContain('eFrontPhotoRef: selections.eFrontPhoto.uploadedRef');
    expect(stationPageSource).toContain('eBackPhotoRef: selections.eBackPhoto.uploadedRef');
  });

  it("supports taking a photo of the QR code to fill the E station scan input", () => {
    expect(stationPageSource).toContain('const eStationQrCaptureInputRef = useRef<HTMLInputElement | null>(null);');
    expect(stationPageSource).toContain('const [isProcessingEStationQrCapture, setIsProcessingEStationQrCapture] = useState(false);');
    expect(stationPageSource).toContain('const detectQrCodeFromImageFile = async (file: File) => {');
    expect(stationPageSource).toContain('capture="environment"');
    expect(stationPageSource).toContain('accept="image/*"');
    expect(stationPageSource).toContain('onChange={handleEStationQrCaptureChange}');
    expect(stationPageSource).toContain('拍照掃描 QR');
    expect(stationPageSource).toContain('已從 QR 辨識到 ${detectedValue}，請確認抹除完成後再推進下一站');
    expect(stationPageSource).toContain('掃描、拍照或輸入商品批號、序號或 IMEI 後，確認抹除完成即可推進下一站');
  });

  it("extends station completion router input with E station photo payloads", () => {
    expect(routersSource).toContain("const stationPhotoInputSchema = z.object({");
    expect(routersSource).toContain("eFrontPhoto: stationPhotoInputSchema.optional()");
    expect(routersSource).toContain("eBackPhoto: stationPhotoInputSchema.optional()");
  });

  it("queues E station photos for true background sync and uploads them into the configured Google Drive folder in the worker", () => {
    expect(dbSource).toContain('uploadStationPhotoToGoogleDrive');
    expect(dbSource).toContain('getGoogleDriveAccessToken()');
    expect(dbSource).toContain('upload/drive/v3/files');
    expect(dbSource).toContain('E_STATION_GOOGLE_DRIVE_FOLDER_ID');
    expect(dbSource).toContain('ePhotoPendingUploads');
    expect(dbSource).toContain('ePhotoSyncStatus = "queued_background"');
    expect(dbSource).toContain('ePhotoSyncMessage = "E 站照片已排入背景同步佇列"');
    expect(dbSource).toContain('jobType: "e_station_photo_sync"');
    expect(dbSource).toContain('triggerEStationPhotoSyncInBackground();');
    expect(dbSource).toContain('runEStationPhotoSyncInProcess');
    expect(dbSource).toContain('ePhotoSyncAttempts');
  });

  it("shows the global toast at the top so the E station complete button is not blocked", () => {
    expect(appSource).toContain('<Toaster position="top-center" richColors />');
    expect(stationPageSource).toContain('toast.success(result?.message ?? "E 站抹除已完成並推進下一站，請直接掃描下一筆")');
    expect(stationPageSource).toContain('完成 E 站後會先快速保存，並在背景同步到採購單 AC 欄');
    expect(stationPageSource).toContain('照片已完成上傳；按完成時只會送照片參照，採購單連結稍後回寫。');
    expect(dbSource).toContain('E 站抹除已完成並推進下一站，照片已排入背景同步');
  });

  it("compresses E station photos before submit to reduce the mobile completion wait", () => {
    expect(stationPageSource).toContain('const maxSide = 1280');
    expect(stationPageSource).toContain('canvas.toDataURL("image/jpeg", 0.72)');
  });
});
