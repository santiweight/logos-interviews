import { describe, expect, it } from "vitest";
import { ansiTerminalSegments } from "./ansiTerminal";

describe("ansiTerminalSegments", () => {
  it("keeps plain terminal text unchanged", () => {
    expect(ansiTerminalSegments("plain <text>")).toEqual([
      { text: "plain <text>", style: {} },
    ]);
  });

  it("applies standard foreground colors and bold text", () => {
    expect(ansiTerminalSegments("a\x1b[1;32mb\x1b[0mc")).toEqual([
      { text: "a", style: {} },
      { text: "b", style: { color: "#1a7f37", fontWeight: "700" } },
      { text: "c", style: {} },
    ]);
  });

  it("resets foreground and background independently", () => {
    expect(ansiTerminalSegments("\x1b[31;44mred\x1b[39mblue-bg\x1b[49mplain")).toEqual([
      { text: "red", style: { color: "#cf222e", backgroundColor: "#0969da" } },
      { text: "blue-bg", style: { backgroundColor: "#0969da" } },
      { text: "plain", style: {} },
    ]);
  });

  it("supports bright, 256-color, and truecolor SGR forms", () => {
    expect(ansiTerminalSegments("\x1b[93mbright\x1b[38;5;202mansi256\x1b[48;2;1;2;3mtrue")).toEqual([
      { text: "bright", style: { color: "#bf8700" } },
      { text: "ansi256", style: { color: "rgb(255, 95, 0)" } },
      {
        text: "true",
        style: { color: "rgb(255, 95, 0)", backgroundColor: "rgb(1, 2, 3)" },
      },
    ]);
  });

  it("hides non-SGR CSI control sequences", () => {
    expect(ansiTerminalSegments("a\x1b[2Kb")).toEqual([
      { text: "ab", style: {} },
    ]);
  });
});
