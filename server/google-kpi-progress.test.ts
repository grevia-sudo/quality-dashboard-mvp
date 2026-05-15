import { describe, expect, it } from "vitest";
import { buildAdminEngineerKpiProgressFromGoogleRows } from "./db";

describe("buildAdminEngineerKpiProgressFromGoogleRows", () => {
  it("aggregates Google purchase sheet rows by station and operator within the requested date range", () => {
    const rows = [
      [
        "採購單號",
        "廠商",
        "商品分類",
        "商品批號",
        "商品序號",
        "IMEI",
        "品名",
        "點到貨時間",
        "A1執行人",
        "安裝軟體時間",
        "A2執行人",
        "軟體測試時間",
        "電池檢測",
        "B站故障狀態",
        "B站執行人",
        "測試時間",
        "是否修改B站的狀態回覆",
        "螢幕狀態",
        "機身狀態",
        "C站測試人員",
        "C站完成時間",
        "鏡頭狀態",
        "D站是否修改檢查結果",
        "D站完成時間",
        "D站檢測者",
        "E站抹除完成時間",
        "E站測試人員",
      ],
      [
        "PO-1",
        "譯通",
        "智慧型手機",
        "0050001",
        "SN-1",
        "IMEI-1",
        "iPhone",
        "2026/05/14 10:00",
        "宥凱",
        "2026/05/14 10:10",
        "小周",
        "2026/05/14 10:20",
        "100",
        "正常",
        "佳穎",
        "2026/05/14 10:30",
        "N",
        "正常",
        "正常",
        "巧克力",
        "2026/05/14 10:40",
        "正常",
        "N",
        "2026/05/14 10:50",
        "巧克力",
        "2026/05/14 11:00",
        "巧克力",
      ],
      [
        "PO-2",
        "譯通",
        "智慧型手機",
        "0050002",
        "SN-2",
        "IMEI-2",
        "iPhone",
        "2026/05/15 09:00",
        "宥凱",
        "2026/05/15 09:10",
        "小周",
        "2026/05/15 09:20",
        "90",
        "正常",
        "佳穎",
        "2026/05/15 09:30",
        "N",
        "正常",
        "正常",
        "巧克力",
        "2026/05/15 09:40",
        "正常",
        "N",
        "2026/05/15 09:50",
        "巧克力",
        "2026/05/15 10:00",
        "巧克力",
      ],
      [
        "PO-3",
        "譯通",
        "智慧型手機",
        "0050003",
        "SN-3",
        "IMEI-3",
        "iPhone",
        "2026/05/15 09:00",
        "外部人員",
        "2026/05/15 09:10",
        "",
        "",
        "80",
        "正常",
        "",
        "",
        "N",
        "正常",
        "正常",
        "",
        "",
        "正常",
        "N",
        "",
        "",
        "",
        "",
      ],
      [
        "PO-old",
        "譯通",
        "智慧型手機",
        "0050004",
        "SN-4",
        "IMEI-4",
        "iPhone",
        "2026/05/13 09:00",
        "宥凱",
        "2026/05/13 09:10",
        "",
        "",
        "80",
        "正常",
        "",
        "",
        "N",
        "正常",
        "正常",
        "",
        "",
        "正常",
        "N",
        "",
        "",
        "",
        "",
      ],
    ];

    const result = buildAdminEngineerKpiProgressFromGoogleRows({
      userRows: [
        { id: 11, username: "youkai", name: "宥凱", role: "user" },
        { id: 12, username: "zhou", name: "小周", role: "user" },
        { id: 13, username: "jiaying", name: "佳穎", role: "user" },
        { id: 14, username: "choco", name: "巧克力", role: "user" },
        { id: 15, username: "idle", name: "待命人員", role: "user" },
      ],
      supportRows: [
        { userId: 11, businessDate: new Date("2026-05-15T00:00:00.000Z"), supportHours: 2 },
      ],
      purchaseSheetRows: rows,
      range: {
        todayKey: "2026-05-15",
        startDate: "2026-05-14",
        endDate: "2026-05-15",
      },
    });

    const youkai = result.find((row) => row.userId === 11);
    const choco = result.find((row) => row.userId === 14);
    const external = result.find((row) => row.name === "外部人員");
    const idle = result.find((row) => row.userId === 15);

    expect(youkai).toBeTruthy();
    expect(youkai?.monthTotalDisplayPoints).toBe(27);
    expect(youkai?.todayDisplayPoints).toBe(26);
    expect(youkai?.todaySupportDisplayPoints).toBe(25);
    expect(youkai?.rangeSupportDisplayPoints).toBe(25);
    expect(youkai?.stationBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stationCode: "A1", completedQty: 2, totalDisplayPoints: 2 }),
        expect.objectContaining({ stationCode: "SUPPORT", supportHours: 2, totalDisplayPoints: 25 }),
      ]),
    );

    expect(choco?.monthTotalDisplayPoints).toBeCloseTo(6, 5);
    expect(choco?.todayDisplayPoints).toBeCloseTo(3, 5);
    expect(choco?.stationBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stationCode: "C", completedQty: 2, totalDisplayPoints: 2 }),
        expect.objectContaining({ stationCode: "D", completedQty: 2, totalDisplayPoints: 2 }),
        expect.objectContaining({ stationCode: "E", completedQty: 2, totalDisplayPoints: 2 }),
      ]),
    );

    expect(external?.monthTotalDisplayPoints).toBeCloseTo(1, 5);
    expect(external?.role).toBe("google_sheet");
    expect(external?.stationBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stationCode: "A1", completedQty: 1, totalDisplayPoints: 1 }),
      ]),
    );

    expect(idle?.monthTotalDisplayPoints).toBe(0);
    expect(idle?.zeroScoreCategory).toBe("本月未作業");
  });
});
