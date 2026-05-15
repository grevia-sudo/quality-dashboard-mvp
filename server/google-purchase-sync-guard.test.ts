import { describe, expect, it } from "vitest";
import { shouldBlockGooglePurchaseSync } from "../scripts/sync-purchase-sheet.mjs";

describe("shouldBlockGooglePurchaseSync", () => {
  it("blocks known test po prefixes", () => {
    expect(shouldBlockGooglePurchaseSync({
      poNumber: "PO-BACKUP-1778826816943",
      vendorName: "正式廠商",
    })).toBe(true);

    expect(shouldBlockGooglePurchaseSync({
      poNumber: "TEST-A1-IMEI-1778826816380",
      vendorName: "正式廠商",
    })).toBe(true);
  });

  it("blocks verification vendors even when po number looks normal", () => {
    expect(shouldBlockGooglePurchaseSync({
      poNumber: "PO-20260515-02",
      vendorName: "品類流程整合驗證",
    })).toBe(true);
  });

  it("keeps ordinary production purchase orders syncable", () => {
    expect(shouldBlockGooglePurchaseSync({
      poNumber: "PO-20260515-11",
      vendorName: "譯通通信",
    })).toBe(false);
  });
});
