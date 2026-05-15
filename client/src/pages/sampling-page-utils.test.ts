import { describe, expect, it } from "vitest";
import { buildEditableOptionList, resolveDraftOptionIds } from "./SamplingPage";

describe("sampling page defect option helpers", () => {
  it("keeps inactive but currently selected B-fault options visible so D station can uncheck them", () => {
    const options = [
      { id: 1, label: "震動馬達異常", active: true },
      { id: 2, label: "充電孔異常", active: false },
      { id: 3, label: "Face ID 異常", active: true },
    ];

    expect(buildEditableOptionList(options, [2])).toEqual([
      { id: 1, label: "震動馬達異常", active: true },
      { id: 2, label: "充電孔異常", active: false },
      { id: 3, label: "Face ID 異常", active: true },
    ]);
  });

  it("can still resolve an inactive historical option id from inherited summary when task metadata ids are empty", () => {
    const options = [
      { id: 2, label: "充電孔異常", active: false },
      { id: 3, label: "Face ID 異常", active: true },
    ];

    expect(resolveDraftOptionIds([], "充電孔異常", options)).toEqual([2]);
    expect(resolveDraftOptionIds([3], "充電孔異常", options)).toEqual([3]);
  });
});
