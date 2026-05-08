import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(stationPageSource).toContain('toast.error("請先拍攝正面與反面照片，再完成 E 站抹除")');
    expect(stationPageSource).toContain('eFrontPhoto: selections.eFrontPhoto');
    expect(stationPageSource).toContain('eBackPhoto: selections.eBackPhoto');
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

  it("uploads E station photos to Google Drive and falls back to system storage when Drive is unavailable", () => {
    expect(dbSource).toContain('const E_STATION_PHOTO_DRIVE_FOLDER_ID = "1PPdt4swkmSav8G6k2Dfpk55OBPJk4srW"');
    expect(dbSource).toContain('uploadStationPhotoToGoogleDrive');
    expect(dbSource).toContain('uploadStationPhotoWithFallback');
    expect(dbSource).toContain('storagePut(`station-e-photos/${photo.fileName}`');
    expect(dbSource).toContain('syncStatus: "storage_fallback"');
    expect(dbSource).toContain('AC${rowNumber}:AD${rowNumber}');
    expect(dbSource).toContain('eFrontPhotoUrl');
    expect(dbSource).toContain('eBackPhotoUrl');
    expect(dbSource).toContain('ePhotoSyncStatus');
    expect(dbSource).toContain('ePhotoSyncMessage');
  });

  it("shows a warning toast on the E station page when photo sync falls back from Google Drive", () => {
    expect(stationPageSource).toContain('if (result?.message) {');
    expect(stationPageSource).toContain('toast.warning(result.message);');
    expect(dbSource).toContain('E 站抹除已完成，照片已改存系統備援空間；Google Drive 同步稍後再處理');
  });
});
