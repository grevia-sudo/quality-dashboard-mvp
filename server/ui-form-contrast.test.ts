import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("ui form contrast styling", () => {
  it("adds stronger global field contrast tokens and reusable editable-field utilities", () => {
    const source = read("client/src/index.css");

    expect(source).toContain("--field-background:");
    expect(source).toContain("--field-border:");
    expect(source).toContain(".editable-field");
    expect(source).toContain(".editable-select");
    expect(source).toContain(".editable-textarea");
    expect(source).toContain("box-shadow: 0 0 0 4px");
  });

  it("separates dashboard chrome from the main work surface", () => {
    const source = read("client/src/components/DashboardLayout.tsx");

    expect(source).toContain("bg-[linear-gradient(180deg,rgba(245,248,252,0.98),rgba(237,243,249,0.98))]");
    expect(source).toContain("bg-[linear-gradient(180deg,rgba(244,247,251,0.45),rgba(250,252,255,0.7))]");
  });

  it("applies editable-field styling on form-heavy admin and import pages", () => {
    const adminPage = read("client/src/pages/AdminPage.tsx");
    const importPage = read("client/src/pages/ImportPage.tsx");

    expect(adminPage).toContain('className="editable-field rounded-2xl border-0 bg-slate-50"');
    expect(adminPage).toContain('className="editable-select h-10 rounded-2xl border-0 bg-slate-50 px-3 text-slate-900 shadow-sm outline-none"');
    expect(importPage).toContain('className="editable-field rounded-2xl border-0 bg-slate-50"');
    expect(importPage).toContain('className="editable-field rounded-2xl border-0 bg-white"');
  });

  it("applies editable-field styling on station and sampling workflows", () => {
    const stationPage = read("client/src/pages/StationPage.tsx");
    const samplingPage = read("client/src/pages/SamplingPage.tsx");

    expect(stationPage).toContain('className="editable-field h-14 rounded-2xl border-0 bg-slate-50 text-base"');
    expect(stationPage).toContain('className="editable-select h-12 w-full rounded-2xl border-0 bg-slate-50 px-4 text-slate-900"');
    expect(samplingPage).toContain('className="editable-field h-12 rounded-2xl border-0 bg-slate-50 pl-11"');
    expect(samplingPage).toContain('className="editable-textarea min-h-28 rounded-2xl border-0 bg-slate-50"');
  });
});
