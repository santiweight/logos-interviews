import { describe, expect, it } from "vitest";
import { snippetPopupTargetForClick } from "./snippetHitTest";

describe("snippet popup hit testing", () => {
  const snippet = {
    id: "prime-snippet",
    startLine: 10,
    startColumn: 3,
    endLine: 14,
    endColumn: 6,
  };

  it("opens for clicks inside the snippet body", () => {
    expect(snippetPopupTargetForClick([snippet], 11, 5)).toBe(snippet);
  });

  it("opens for clicks on the first and last character inside the snippet", () => {
    expect(snippetPopupTargetForClick([snippet], 10, 3)).toBe(snippet);
    expect(snippetPopupTargetForClick([snippet], 14, 5)).toBe(snippet);
  });

  it("does not open for clicks before the snippet start", () => {
    expect(snippetPopupTargetForClick([snippet], 10, 2)).toBeNull();
    expect(snippetPopupTargetForClick([snippet], 9, 20)).toBeNull();
  });

  it("does not open for clicks after the snippet, even nearby", () => {
    expect(snippetPopupTargetForClick([snippet], 14, 6)).toBeNull();
    expect(snippetPopupTargetForClick([snippet], 14, 7)).toBeNull();
    expect(snippetPopupTargetForClick([snippet], 15, 1)).toBeNull();
    expect(snippetPopupTargetForClick([snippet], 16, 1)).toBeNull();
  });

  it("does not open for clicks after text on a middle snippet line", () => {
    expect(snippetPopupTargetForClick([snippet], 12, 19, 20)).toBe(snippet);
    expect(snippetPopupTargetForClick([snippet], 12, 20, 20)).toBeNull();
    expect(snippetPopupTargetForClick([snippet], 12, 24, 20)).toBeNull();
  });
});
