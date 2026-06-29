import { Replayer, type eventWithTime } from "rrweb";
import "rrweb/dist/style.css";
import "./sessionReplay.css";

type SessionReplayResponse = {
  ok?: boolean;
  sessionId?: string;
  records?: unknown[];
  replayEvents?: eventWithTime[];
  error?: string;
};

type CapturedSnapshot = {
  label: string;
  editor: string;
  compilation: string;
};

const app = requiredQuery<HTMLDivElement>("#replay-app");

app.innerHTML = `
  <section class="replay-shell">
    <header class="replay-toolbar">
      <a class="replay-brand" href="/">Logos</a>
      <form class="replay-form" data-replay-form>
        <label class="replay-field">
          <span>Session ID</span>
          <input type="text" name="sessionId" autocomplete="off" spellcheck="false" />
        </label>
        <button type="submit">Load</button>
      </form>
      <div class="replay-status" data-replay-status aria-live="polite"></div>
    </header>
    <div class="replay-content">
      <aside class="replay-trace" data-replay-trace>
        <div class="replay-empty">Load a captured session to inspect its trace.</div>
      </aside>
      <section class="replay-player" data-replay-player></section>
    </div>
  </section>
`;

const form = requiredQuery<HTMLFormElement>("[data-replay-form]");
const sessionInput = requiredQuery<HTMLInputElement>("[name='sessionId']");
const status = requiredQuery<HTMLDivElement>("[data-replay-status]");
const trace = requiredQuery<HTMLElement>("[data-replay-trace]");
const playerRoot = requiredQuery<HTMLElement>("[data-replay-player]");
let replayer: Replayer | null = null;

const initialSessionId = new URLSearchParams(window.location.search).get("sessionId") ?? "";
sessionInput.value = initialSessionId;
if (initialSessionId) {
  void loadReplay(initialSessionId);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const sessionId = sessionInput.value.trim();
  if (sessionId.length === 0) {
    setStatus("Enter a session id.", "error");
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("sessionId", sessionId);
  window.history.replaceState(null, "", url);
  void loadReplay(sessionId);
});

async function loadReplay(sessionId: string): Promise<void> {
  setStatus("Loading...", "loading");
  trace.innerHTML = "";
  playerRoot.innerHTML = "";
  replayer?.destroy();
  replayer = null;

  try {
    const response = await fetch(`/api/session-events/${encodeURIComponent(sessionId)}`);
    const payload = await response.json() as SessionReplayResponse;
    if (!response.ok || payload.ok !== true || !Array.isArray(payload.records)) {
      throw new Error(payload.error ?? "Session replay request failed");
    }

    const replayEvents = Array.isArray(payload.replayEvents) ? payload.replayEvents : [];
    renderTrace(payload.records, replayEvents);

    if (replayEvents.length === 0) {
      setStatus("No replay events found for this session.", "error");
      return;
    }

    replayer = new Replayer(replayEvents, {
      root: playerRoot,
      showWarning: false,
      mouseTail: false,
    });
    replayer.play();
    setStatus(`${payload.records.length} records - ${replayEvents.length} replay events`, "ready");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    trace.innerHTML = `<div class="replay-empty">Could not load this session.</div>`;
  }
}

function renderTrace(records: unknown[], replayEvents: eventWithTime[]): void {
  const eventCounts = new Map<string, number>();
  const snapshots = snapshotsFromRecords(records);
  const latestSnapshot = snapshots.at(-1) ?? null;

  for (const record of records) {
    const event = isObject(record) && isObject(record.event) ? record.event : null;
    const type = typeof event?.type === "string" ? event.type : "unknown";
    eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
  }

  const rows = [...eventCounts.entries()]
    .sort(([leftType, leftCount], [rightType, rightCount]) => {
      return rightCount - leftCount || leftType.localeCompare(rightType);
    })
    .map(([type, count]) => `
      <div class="replay-trace-row">
        <span>${escapeHtml(type)}</span>
        <strong>${count}</strong>
      </div>
    `)
    .join("");

  trace.innerHTML = `
    <div class="replay-trace-summary">
      <div>
        <span>Trace records</span>
        <strong>${records.length}</strong>
      </div>
      <div>
        <span>Replay events</span>
        <strong>${replayEvents.length}</strong>
      </div>
    </div>
    <div class="replay-trace-list">${rows}</div>
    ${latestSnapshot ? renderSnapshot(latestSnapshot) : ""}
  `;
}

function snapshotsFromRecords(records: unknown[]): CapturedSnapshot[] {
  const snapshots: CapturedSnapshot[] = [];

  for (const record of records) {
    if (!isObject(record) || !isObject(record.event) || !isObject(record.event.state)) {
      continue;
    }

    const state = record.event.state;
    const editor = isObject(state.editor) && typeof state.editor.value === "string"
      ? state.editor.value
      : "";
    const ui = isObject(state.ui) ? state.ui : {};
    const selectedSnippet = isObject(ui.selectedSnippet) ? ui.selectedSnippet : {};
    const compilation = typeof selectedSnippet.preview === "string" && selectedSnippet.preview.length > 0
      ? selectedSnippet.preview
      : typeof ui.implementation === "string"
        ? ui.implementation
        : "";

    if (!editor && !compilation) {
      continue;
    }

    const eventType = typeof record.event.type === "string" ? record.event.type : "snapshot";
    const occurredAt = typeof record.event.occurredAt === "string"
      ? new Date(record.event.occurredAt).toLocaleTimeString()
      : "";

    snapshots.push({
      label: occurredAt ? `${eventType} at ${occurredAt}` : eventType,
      editor,
      compilation,
    });
  }

  return snapshots;
}

function renderSnapshot(snapshot: CapturedSnapshot): string {
  return `
    <details class="replay-snapshot">
      <summary>Captured app state</summary>
      <div class="replay-snapshot-label">${escapeHtml(snapshot.label)}</div>
      <details open>
        <summary>Code area</summary>
        <pre>${escapeHtml(snapshot.editor || "(empty)")}</pre>
      </details>
      <details open>
        <summary>Compilation view</summary>
        <pre>${escapeHtml(snapshot.compilation || "(empty)")}</pre>
      </details>
    </details>
  `;
}

function setStatus(message: string, state: "loading" | "ready" | "error"): void {
  status.textContent = message;
  status.dataset.state = state;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredQuery<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}
