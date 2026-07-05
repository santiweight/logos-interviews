import { describe, expect, it } from "vitest";
import { LogosService, type NewSheetInput } from "./logosService";

const emptySheet = (id: string): NewSheetInput => ({
  id,
  projectId: id,
  title: id,
  source: "",
});

describe("LogosService project state", () => {
  it("does not re-seed defaults after all sheets are deleted", () => {
    const service = new LogosService({ model: "claude-sonnet-5" });
    const defaults = [emptySheet("first"), emptySheet("second")];

    expect(service.initializeDefaultProject(defaults).map((sheet) => sheet.id)).toEqual(["first", "second"]);
    expect(service.deleteSheet("first")).toBe(true);
    expect(service.deleteSheet("second")).toBe(true);

    expect(service.initializeDefaultProject(defaults)).toEqual([]);

    service.clear();
    expect(service.initializeDefaultProject(defaults).map((sheet) => sheet.id)).toEqual(["first", "second"]);
  });

  it("replaces the default project exactly", () => {
    const service = new LogosService({ model: "claude-sonnet-5" });
    service.initializeDefaultProject([emptySheet("old-one"), emptySheet("old-two")]);

    const next = service.replaceDefaultProject([emptySheet("new-one")]);

    expect(next.map((sheet) => sheet.id)).toEqual(["new-one"]);
    expect(service.allSheets().map((sheet) => sheet.id)).toEqual(["new-one"]);
  });
});
