import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");

describe("admin menu settings layout source coverage", () => {
  it("renders menu settings as a wider horizontal editing layout", () => {
    expect(adminPageSource).toContain("功能表設定改成與 C 站作業相同的寬版編輯節奏");
    expect(adminPageSource).toContain('xl:grid-cols-2');
    expect(adminPageSource).toContain('xl:grid-cols-[minmax(0,1.6fr)_140px_120px]');
    expect(adminPageSource).toContain("目前共 {sectionItems.length} 個可編輯項目");
    expect(adminPageSource).toContain("新增一個項目");
    expect(adminPageSource).toContain("項目名稱");
    expect(adminPageSource).toContain("排序");
    expect(adminPageSource).toContain("狀態");
  });
});
