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

  it("extends station completion router input with E station photo payloads", () => {
    expect(routersSource).toContain("const stationPhotoInputSchema = z.object({");
    expect(routersSource).toContain("eFrontPhoto: stationPhotoInputSchema.optional()");
    expect(routersSource).toContain("eBackPhoto: stationPhotoInputSchema.optional()");
  });

  it("uploads E station photos to Google Drive and writes links back to AC and AD", () => {
    expect(dbSource).toContain('const E_STATION_PHOTO_DRIVE_FOLDER_ID = "1PPdt4swkmSav8G6k2Dfpk55OBPJk4srW"');
    expect(dbSource).toContain('uploadStationPhotoToGoogleDrive');
    expect(dbSource).toContain('fileName: `${fileNameBase}-1.jpg`');
    expect(dbSource).toContain('fileName: `${fileNameBase}-2.jpg`');
    expect(dbSource).toContain('AC${rowNumber}:AD${rowNumber}');
    expect(dbSource).toContain('eFrontPhotoUrl');
    expect(dbSource).toContain('eBackPhotoUrl');
  });
});
