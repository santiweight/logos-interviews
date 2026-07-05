import * as React from "react";

const e = React.createElement;

type AgentViewProps = {
  sheetId: string | null;
};

type SessionPollResult = {
  events: Array<{ kind: string; text?: string; tool?: string; input?: Record<string, unknown>; code?: string }>;
  done: boolean;
  implementation: string;
};

export function AgentView({ sheetId }: AgentViewProps) {
  const [events, setEvents] = React.useState<SessionPollResult["events"]>([]);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [compiling, setCompiling] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!sheetId) {
      setEvents([]);
      setSessionId(null);
      setCompiling(false);
      return;
    }

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const sheetRes = await fetch(`/api/v2/sheet?id=${encodeURIComponent(sheetId!)}`);
          if (!sheetRes.ok || cancelled) break;
          const sheetState = await sheetRes.json();
          const sid = sheetState.currentSessionId;

          if (!sid) {
            setCompiling(false);
            if (!sessionId) setEvents([]);
            await sleep(500);
            continue;
          }

          setSessionId(sid);
          setCompiling(true);

          const sessionRes = await fetch(`/api/v2/session?id=${encodeURIComponent(sid)}&after=0`);
          if (!sessionRes.ok || cancelled) break;
          const session = await sessionRes.json();

          if (!cancelled) {
            setEvents(session.events);
            if (session.done) {
              setCompiling(false);
            }
          }

          if (session.done) {
            await sleep(1000);
          } else {
            await sleep(200);
          }
        } catch {
          await sleep(1000);
        }
      }
    }

    void poll();
    return () => { cancelled = true; };
  }, [sheetId]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const agentEvents = events.filter((e) => e.kind === "agent-text" || e.kind === "agent-tool");

  if (compiling && agentEvents.length === 0) {
    return e("div", { ref: containerRef },
      e("div", { className: "agent-status-banner" },
        e("span", { className: "agent-spinner" }),
        " Agent is generating code for your file",
      ),
    );
  }

  if (agentEvents.length === 0) {
    return e("div", { ref: containerRef });
  }

  return e("div", { ref: containerRef },
    agentEvents.map((event, i) => {
      if (event.kind === "agent-text") {
        return e("div", { key: i, className: "agent-message agent-message-text" }, event.text);
      }
      const input = (event.input ?? {}) as Record<string, unknown>;
      const command = (input.command as string) ?? event.tool ?? "unknown";
      let body: string;
      if (command === "str_replace") {
        body = `- ${input.old_str ?? ""}\n+ ${input.new_str ?? ""}`;
      } else if (command === "create") {
        const text = (input.file_text as string) ?? "";
        body = `Created file (${text.split("\n").length} lines)`;
      } else if (command === "insert") {
        body = `After line ${input.insert_line}\n${input.new_str ?? ""}`;
      } else if (command === "view") {
        body = input.view_range ? `Lines ${(input.view_range as number[]).join("–")}` : "Viewing file";
      } else {
        body = JSON.stringify(input, null, 2);
      }
      return e("div", { key: i, className: "agent-message agent-message-tool" },
        e("div", { className: "agent-tool-header" }, command),
        e("pre", { className: "agent-tool-body" }, body),
      );
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
