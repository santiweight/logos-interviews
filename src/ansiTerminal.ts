export type AnsiTerminalStyle = {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecorationLine?: string;
  opacity?: string;
};

export type AnsiTerminalSegment = {
  text: string;
  style: AnsiTerminalStyle;
};

type AnsiState = {
  foreground?: string;
  background?: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
};

const csiPattern = /\x1b\[([0-?]*)([ -/]*)([@-~])/g;

const ansiColors = [
  "#1f2328",
  "#cf222e",
  "#1a7f37",
  "#9a6700",
  "#0969da",
  "#8250df",
  "#1b7c83",
  "#f6f8fa",
  "#57606a",
  "#d1242f",
  "#2da44e",
  "#bf8700",
  "#218bff",
  "#a475f9",
  "#3192aa",
  "#ffffff",
];

export function renderAnsiTerminalText(target: HTMLElement, text: string): void {
  if (!text.includes("\x1b")) {
    target.textContent = text;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const segment of ansiTerminalSegments(text)) {
    if (Object.keys(segment.style).length === 0) {
      fragment.append(document.createTextNode(segment.text));
      continue;
    }

    const span = document.createElement("span");
    span.textContent = segment.text;
    applySegmentStyle(span, segment.style);
    fragment.append(span);
  }

  target.replaceChildren(fragment);
}

export function ansiTerminalSegments(text: string): AnsiTerminalSegment[] {
  const segments: AnsiTerminalSegment[] = [];
  const state: AnsiState = initialState();
  let cursor = 0;

  csiPattern.lastIndex = 0;
  for (const match of text.matchAll(csiPattern)) {
    if (match.index > cursor) {
      appendSegment(segments, text.slice(cursor, match.index), styleForState(state));
    }

    const parameters = match[1] ?? "";
    const intermediates = match[2] ?? "";
    const finalByte = match[3] ?? "";
    if (finalByte === "m" && intermediates === "") {
      applySgrParameters(state, parameters);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    appendSegment(segments, text.slice(cursor), styleForState(state));
  }

  return segments;
}

function appendSegment(
  segments: AnsiTerminalSegment[],
  text: string,
  style: AnsiTerminalStyle,
): void {
  if (text.length === 0) {
    return;
  }

  const previous = segments.at(-1);
  if (previous && stylesEqual(previous.style, style)) {
    previous.text += text;
    return;
  }

  segments.push({ text, style });
}

function initialState(): AnsiState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
  };
}

function styleForState(state: AnsiState): AnsiTerminalStyle {
  const foreground = state.inverse ? state.background : state.foreground;
  const background = state.inverse ? state.foreground : state.background;
  const style: AnsiTerminalStyle = {};

  if (foreground) {
    style.color = foreground;
  } else if (state.inverse) {
    style.color = "var(--paper)";
  }

  if (background) {
    style.backgroundColor = background;
  } else if (state.inverse) {
    style.backgroundColor = "var(--ink)";
  }

  if (state.bold) {
    style.fontWeight = "700";
  }
  if (state.dim) {
    style.opacity = "0.68";
  }
  if (state.italic) {
    style.fontStyle = "italic";
  }
  if (state.underline) {
    style.textDecorationLine = "underline";
  }

  return style;
}

function applySgrParameters(state: AnsiState, parameterText: string): void {
  const parameters = parseSgrParameters(parameterText);

  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index] ?? 0;

    if (parameter === 0) {
      resetState(state);
    } else if (parameter === 1) {
      state.bold = true;
    } else if (parameter === 2) {
      state.dim = true;
    } else if (parameter === 3) {
      state.italic = true;
    } else if (parameter === 4) {
      state.underline = true;
    } else if (parameter === 7) {
      state.inverse = true;
    } else if (parameter === 22) {
      state.bold = false;
      state.dim = false;
    } else if (parameter === 23) {
      state.italic = false;
    } else if (parameter === 24) {
      state.underline = false;
    } else if (parameter === 27) {
      state.inverse = false;
    } else if (parameter >= 30 && parameter <= 37) {
      state.foreground = ansiColors[parameter - 30];
    } else if (parameter === 39) {
      state.foreground = undefined;
    } else if (parameter >= 40 && parameter <= 47) {
      state.background = ansiColors[parameter - 40];
    } else if (parameter === 49) {
      state.background = undefined;
    } else if (parameter >= 90 && parameter <= 97) {
      state.foreground = ansiColors[parameter - 90 + 8];
    } else if (parameter >= 100 && parameter <= 107) {
      state.background = ansiColors[parameter - 100 + 8];
    } else if (parameter === 38 || parameter === 48) {
      const extended = readExtendedColor(parameters, index + 1);
      if (extended) {
        if (parameter === 38) {
          state.foreground = extended.color;
        } else {
          state.background = extended.color;
        }
        index += extended.consumed;
      }
    }
  }
}

function parseSgrParameters(parameterText: string): number[] {
  if (parameterText.length === 0) {
    return [0];
  }

  return parameterText.split(/[;:]/).map((part) => {
    if (part.length === 0) {
      return 0;
    }

    const value = Number(part);
    return Number.isInteger(value) ? value : 0;
  });
}

function readExtendedColor(
  parameters: number[],
  start: number,
): { color: string; consumed: number } | null {
  const mode = parameters[start];
  if (mode === 5) {
    const color = ansi256Color(parameters[start + 1]);
    return color ? { color, consumed: 2 } : null;
  }

  if (mode === 2) {
    const red = parameters[start + 1];
    const green = parameters[start + 2];
    const blue = parameters[start + 3];
    if (isRgbChannel(red) && isRgbChannel(green) && isRgbChannel(blue)) {
      return { color: `rgb(${red}, ${green}, ${blue})`, consumed: 4 };
    }
  }

  return null;
}

function ansi256Color(value: number | undefined): string | null {
  if (value === undefined || value < 0 || value > 255) {
    return null;
  }

  if (value < 16) {
    return ansiColors[value];
  }

  if (value >= 16 && value <= 231) {
    const offset = value - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const red = steps[Math.floor(offset / 36)];
    const green = steps[Math.floor((offset % 36) / 6)];
    const blue = steps[offset % 6];
    return `rgb(${red}, ${green}, ${blue})`;
  }

  const level = 8 + (value - 232) * 10;
  return `rgb(${level}, ${level}, ${level})`;
}

function resetState(state: AnsiState): void {
  state.foreground = undefined;
  state.background = undefined;
  state.bold = false;
  state.dim = false;
  state.italic = false;
  state.underline = false;
  state.inverse = false;
}

function isRgbChannel(value: number | undefined): value is number {
  return value !== undefined && value >= 0 && value <= 255;
}

function applySegmentStyle(element: HTMLElement, style: AnsiTerminalStyle): void {
  if (style.color) {
    element.style.color = style.color;
  }
  if (style.backgroundColor) {
    element.style.backgroundColor = style.backgroundColor;
  }
  if (style.fontWeight) {
    element.style.fontWeight = style.fontWeight;
  }
  if (style.fontStyle) {
    element.style.fontStyle = style.fontStyle;
  }
  if (style.textDecorationLine) {
    element.style.textDecorationLine = style.textDecorationLine;
  }
  if (style.opacity) {
    element.style.opacity = style.opacity;
  }
}

function stylesEqual(left: AnsiTerminalStyle, right: AnsiTerminalStyle): boolean {
  return (
    left.color === right.color &&
    left.backgroundColor === right.backgroundColor &&
    left.fontWeight === right.fontWeight &&
    left.fontStyle === right.fontStyle &&
    left.textDecorationLine === right.textDecorationLine &&
    left.opacity === right.opacity
  );
}
