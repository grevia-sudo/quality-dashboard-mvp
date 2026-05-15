import { describe, expect, it } from "vitest";
import { buildEditableOptionList, resolveDraftOptionIds } from "../client/src/pages/SamplingPage";

describe("D 站已停用 B 站故障選項處理", () => {
  it("會保留已停用但目前已選取的故障選項，讓畫面仍可取消勾選", () => {
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

  it("當 task metadata 沒有故障 option ids 時，仍可由歷史摘要對應出已停用的故障選項 id", () => {
    const options = [
      { id: 2, label: "充電孔異常", active: false },
      { id: 3, label: "Face ID 異常", active: true },
    ];

    expect(resolveDraftOptionIds([], "充電孔異常", options)).toEqual([2]);
    expect(resolveDraftOptionIds([3], "充電孔異常", options)).toEqual([3]);
  });
});
