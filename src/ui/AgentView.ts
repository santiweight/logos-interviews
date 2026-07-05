import * as React from "react";
import type { AgentEvent } from "./types";

const e = React.createElement;
const activePollMs = 100;
const errorPollMs = 1000;

type AgentViewProps = {
  compileSessionId: string | null;
  updatingExistingCode: boolean;
  active: boolean;
};

type SessionViewState = {
  sessionId: string | null;
  events: AgentEvent[];
  after: number;
  compiling: boolean;
  implementation: string;
};

function emptySessionState(sessionId: string | null = null): SessionViewState {
  return {
    sessionId,
    events: [],
    after: 0,
    compiling: false,
    implementation: "",
  };
}

export function AgentView({ compileSessionId, updatingExistingCode, active }: AgentViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [state, setState] = React.useState<SessionViewState>(() => emptySessionState(compileSessionId));
  const stateRef = React.useRef(state);

  stateRef.current = state;

  const visibleEvents = state.sessionId === compileSessionId ? state.events : [];
  const visibleCompiling = state.sessionId === compileSessionId && state.compiling;
  const hasImplementation = state.sessionId === compileSessionId && state.implementation.trim().length > 0;

  React.useEffect(() => {
    if (!active || !compileSessionId) {
      setState(emptySessionState(compileSessionId));
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState(emptySessionState(compileSessionId));

    const poll = async () => {
      if (cancelled) return;
      try {
        const current = stateRef.current;
        const after = current.sessionId === compileSessionId ? current.after : 0;
        if (current.sessionId !== compileSessionId) {
          setState({
            sessionId: compileSessionId,
            events: [],
            after: 0,
            compiling: true,
            implementation: "",
          });
        }

        const response = await fetch(`/api/v2/session?id=${encodeURIComponent(compileSessionId)}&after=${after}`);
        if (!response.ok) throw new Error("Compile session request failed");
        const session = await response.json() as {
          events?: AgentEvent[];
          done?: boolean;
          total?: number;
          implementation?: string;
        };
        const nextEvents = session.events ?? [];

        setState((next) => {
          const reset = next.sessionId !== compileSessionId;
          const eventsSoFar = reset ? [] : next.events;
          const nextAfter = typeof session.total === "number" ? session.total : after + nextEvents.length;
          const nextCompiling = session.done !== true;
          const nextImplementation = session.implementation ?? next.implementation;
          if (
            !reset &&
            nextEvents.length === 0 &&
            next.after === nextAfter &&
            next.compiling === nextCompiling &&
            next.implementation === nextImplementation
          ) {
            return next;
          }
          return {
            sessionId: compileSessionId,
            events: nextEvents.length > 0 ? [...eventsSoFar, ...nextEvents] : eventsSoFar,
            after: nextAfter,
            compiling: nextCompiling,
            implementation: nextImplementation,
          };
        });

        if (!session.done) {
          timer = setTimeout(poll, activePollMs);
        }
      } catch {
        setState((next) => next.sessionId === compileSessionId ? { ...next, compiling: false } : next);
        timer = setTimeout(poll, errorPollMs);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, compileSessionId]);

  React.useEffect(() => {
    const element = containerRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [visibleEvents.length, visibleCompiling]);

  return e(
    "div",
    {
      id: "agent-view-panel",
      ref: containerRef,
      className: `output agent-view-output tab-panel${active ? " active" : ""}`,
      role: "tabpanel",
      "aria-labelledby": "agent-view-tab",
      "aria-live": "polite",
    },
    !visibleCompiling && visibleEvents.length === 0 && hasImplementation
      ? e(
          "div",
          { className: "agent-message agent-message-tool" },
          e("div", { className: "agent-tool-header" }, "Loaded implementation"),
          e("pre", { className: "agent-tool-body" }, previewCode(state.implementation)),
        )
      : null,
    !visibleCompiling && visibleEvents.length === 0 && !hasImplementation
      ? e("div", { className: "agent-message agent-message-text" }, "Compile this sheet to see agent steps here.")
      : null,
    visibleEvents.map((event, index) => {
      if (event.kind === "agent-text") {
        return e("div", { key: index, className: "agent-message agent-message-text" }, event.text ?? "");
      }
      if (event.kind === "error") {
        return e("div", { key: index, className: "agent-message agent-message-tool" }, event.message ?? "Compilation failed");
      }
      if (event.kind === "scaffold" || event.kind === "implementation" || event.kind === "done") {
        return e(
          "div",
          { key: index, className: "agent-message agent-message-tool" },
          e("div", { className: "agent-tool-header" }, eventLabel(event.kind)),
          e("pre", { className: "agent-tool-body" }, previewCode(event.code)),
        );
      }

      const input = asRecord(event.input);
      const command = String(input.command ?? event.name ?? event.tool ?? "tool");
      return e(
        "div",
        { key: index, className: "agent-message agent-message-tool" },
        e("div", { className: "agent-tool-header" }, command),
        e("pre", { className: "agent-tool-body" }, toolBody(command, input)),
      );
    }),
    visibleCompiling
      ? e(
          "div",
          {
            key: "agent-running-status",
            className: "agent-status-banner",
            "data-agent-status": "running",
          },
          e("span", { className: "agent-spinner", "aria-hidden": "true" }),
          e("span", null, visibleEvents.length === 0
            ? runningStatusText(updatingExistingCode)
            : "Waiting for Claude to finish"),
        )
      : null,
  );
}

function runningStatusText(updatingExistingCode: boolean): string {
  return updatingExistingCode
    ? "Agent is updating code for your file"
    : "Agent is generating code for your file";
}

function eventLabel(kind: string): string {
  if (kind === "scaffold") return "Scaffold generated";
  if (kind === "implementation") return "Implementation updated";
  if (kind === "done") return "Compilation complete";
  return kind;
}

function previewCode(code: string | undefined): string {
  if (!code) return "";
  const lines = code.split("\n");
  const preview = lines.slice(0, 80).join("\n");
  return lines.length > 80 ? `${preview}\n...` : preview;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function toolBody(command: string, input: Record<string, unknown>): string {
  if (command === "str_replace") {
    return `- ${String(input.old_str ?? "")}\n+ ${String(input.new_str ?? "")}`;
  }
  if (command === "create") {
    const text = String(input.file_text ?? "");
    return `Created file (${text.split("\n").length} lines)`;
  }
  if (command === "insert") {
    return `After line ${String(input.insert_line ?? "")}\n${String(input.new_str ?? "")}`;
  }
  return JSON.stringify(input, null, 2);
}
