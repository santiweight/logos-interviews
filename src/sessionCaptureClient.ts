import { record, takeFullSnapshot } from "rrweb";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

export type JsonObject = { [key: string]: JsonValue | undefined };

export type SessionCapture = {
  sessionId: string;
  track: (type: string, details?: JsonObject, includeSnapshot?: boolean) => void;
  flush: () => Promise<void>;
};

type SessionCaptureOptions = {
  getSnapshot: () => JsonObject;
  endpoint?: string;
};

type QueuedEvent = {
  seq: number;
  type: string;
  occurredAt: string;
  performanceNow: number;
  url: string;
  details?: JsonObject;
  state?: JsonObject;
};

const flushAtEvents = 20;
const maxEventsPerRequest = 100;
const maxQueuedEvents = 500;
const maxBeaconBytes = 60_000;
const replayFullSnapshotIntervalMs = 30_000;
const replaySettledSnapshotDelaysMs = [250, 1_000, 2_500];
const lifecycleCaptureThrottleMs = 500;

export function createSessionCapture(options: SessionCaptureOptions): SessionCapture {
  const endpoint = options.endpoint ?? "/api/session-events";
  const sessionId = getOrCreateSessionId();
  const queue: QueuedEvent[] = [];
  let seq = 0;
  let flushInFlight = false;

  const capture: SessionCapture = {
    sessionId,
    track(type, details, includeSnapshot = false) {
      queue.push({
        seq: seq++,
        type,
        occurredAt: new Date().toISOString(),
        performanceNow: Math.round(performance.now()),
        url: window.location.href,
        details,
        state: includeSnapshot ? options.getSnapshot() : undefined,
      });

      trimQueue();

      if (queue.length >= flushAtEvents) {
        void flush();
      }
    },
    flush,
  };

  document.addEventListener(
    "click",
    (event) => {
      capture.track(
        "click",
        {
          target: describeTarget(event.target),
          pointer: {
            clientX: event.clientX,
            clientY: event.clientY,
            pageX: event.pageX,
            pageY: event.pageY,
            button: event.button,
          },
        },
        true,
      );
    },
    { capture: true },
  );

  document.addEventListener(
    "input",
    (event) => {
      capture.track("input", describeFormEvent(event.target));
    },
    { capture: true },
  );

  document.addEventListener(
    "change",
    (event) => {
      capture.track("change", describeFormEvent(event.target), true);
    },
    { capture: true },
  );

  document.addEventListener(
    "focusin",
    (event) => {
      capture.track("focus_in", { target: describeTarget(event.target) });
    },
    { capture: true },
  );

  document.addEventListener(
    "focusout",
    (event) => {
      capture.track("focus_out", { target: describeTarget(event.target) });
    },
    { capture: true },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      capture.track("keydown", {
        target: describeTarget(event.target),
        key: safeKeyboardKey(event),
        code: event.code,
        repeat: event.repeat,
        modifiers: {
          alt: event.altKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey,
        },
      });
    },
    { capture: true },
  );

  document.addEventListener(
    "copy",
    (event) => {
      capture.track("clipboard_copy", { target: describeTarget(event.target) });
    },
    { capture: true },
  );

  document.addEventListener(
    "cut",
    (event) => {
      capture.track("clipboard_cut", { target: describeTarget(event.target) }, true);
    },
    { capture: true },
  );

  document.addEventListener(
    "paste",
    (event) => {
      capture.track("clipboard_paste", {
        target: describeTarget(event.target),
        textLength: event.clipboardData?.getData("text/plain").length ?? null,
      }, true);
    },
    { capture: true },
  );

  window.addEventListener("resize", throttle(() => {
    capture.track("viewport_resize", viewportSnapshot(), true);
  }, lifecycleCaptureThrottleMs));

  window.addEventListener("scroll", throttle(() => {
    capture.track("window_scroll", viewportSnapshot());
  }, lifecycleCaptureThrottleMs), { passive: true });

  document.addEventListener("visibilitychange", () => {
    capture.track("visibility_change", { visibilityState: document.visibilityState }, true);
    if (document.visibilityState === "hidden") {
      flushWithBeacon();
    }
  });

  window.addEventListener("error", (event) => {
    capture.track(
      "window_error",
      {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
      true,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    capture.track(
      "unhandled_rejection",
      { reason: event.reason instanceof Error ? event.reason.message : String(event.reason) },
      true,
    );
  });

  window.addEventListener("pagehide", () => {
    capture.track("pagehide", undefined, true);
    flushWithBeacon();
  });

  window.setInterval(() => {
    void flush();
  }, 5_000);

  capture.track("session_start", browserSnapshot(), true);
  void flush();
  startDomReplayCapture(capture);

  async function flush(): Promise<void> {
    if (flushInFlight || queue.length === 0) {
      return;
    }

    flushInFlight = true;

    try {
      while (queue.length > 0) {
        const events = queue.splice(0, maxEventsPerRequest);
        try {
          await postEvents(events);
        } catch (error) {
          queue.unshift(...events);
          trimQueue();
          throw error;
        }
      }
    } catch (error) {
      console.error("Session capture failed", error);
    } finally {
      flushInFlight = false;
    }
  }

  function flushWithBeacon(): void {
    if (queue.length === 0) {
      return;
    }

    while (queue.length > 0) {
      const events = queue.splice(0, maxEventsPerRequest);
      const body = JSON.stringify({ sessionId, events });
      const canBeacon = typeof navigator.sendBeacon === "function" && body.length < maxBeaconBytes;
      const sent = canBeacon
        ? navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))
        : false;

      if (sent) {
        continue;
      }

      void postEvents(events).catch((error: unknown) => {
        queue.unshift(...events);
        trimQueue();
        console.error("Session capture failed", error);
      });
    }
  }

  async function postEvents(events: QueuedEvent[]): Promise<void> {
    const body = JSON.stringify({ sessionId, events });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < maxBeaconBytes,
    });

    if (!response.ok) {
      throw new Error(`Session capture request failed with ${response.status}`);
    }
  }

  return capture;

  function trimQueue(): void {
    if (queue.length > maxQueuedEvents) {
      queue.splice(0, queue.length - maxQueuedEvents);
    }
  }
}

function startDomReplayCapture(capture: SessionCapture): void {
  try {
    let stopped = false;
    const stop = record({
      emit(event, isCheckout) {
        capture.track("dom_replay", {
          schema: "rrweb@2",
          checkout: isCheckout === true,
          event: event as JsonObject,
        });
      },
      checkoutEveryNms: replayFullSnapshotIntervalMs,
      maskAllInputs: false,
      blockClass: "rr-block",
      blockSelector: "[data-session-capture-block]",
      ignoreClass: "rr-ignore",
      inlineStylesheet: true,
      recordCanvas: false,
      collectFonts: true,
      sampling: {
        mousemove: 50,
        scroll: 150,
        input: "last",
        media: 800,
      },
      errorHandler(error) {
        capture.track("dom_replay_error", {
          error: error instanceof Error ? error.message : String(error),
        }, true);
        return true;
      },
    });

    scheduleSettledReplaySnapshots(() => !stopped);

    window.addEventListener("pagehide", () => {
      stopped = true;
      stop?.();
    }, { once: true });
  } catch (error) {
    capture.track("dom_replay_error", {
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }
}

function scheduleSettledReplaySnapshots(isActive: () => boolean): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isActive()) {
        takeFullSnapshot(true);
      }
    });
  });

  for (const delay of replaySettledSnapshotDelaysMs) {
    window.setTimeout(() => {
      if (isActive()) {
        takeFullSnapshot(true);
      }
    }, delay);
  }
}

function getOrCreateSessionId(): string {
  const key = "logos-interviews-session-id";
  const existing = safeSessionStorageGet(key);
  if (existing) {
    return existing;
  }

  const next = typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  safeSessionStorageSet(key, next);
  return next;
}

function safeSessionStorageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionStorageSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    return;
  }
}

function browserSnapshot(): JsonObject {
  const now = new Date();
  const attribution = urlAttribution(window.location.href, document.referrer);
  const connection = connectionSnapshot();
  const userAgentData = userAgentDataSnapshot();
  const device = deviceSnapshot();

  return {
    userAgent: window.navigator.userAgent,
    userAgentData,
    language: window.navigator.language,
    languages: [...window.navigator.languages],
    platform: window.navigator.platform,
    vendor: window.navigator.vendor,
    hardwareConcurrency: window.navigator.hardwareConcurrency,
    deviceMemory: deviceMemory(),
    cookieEnabled: window.navigator.cookieEnabled,
    doNotTrack: window.navigator.doNotTrack,
    maxTouchPoints: window.navigator.maxTouchPoints,
    touchCapable: device.touchCapable,
    deviceType: device.deviceType,
    viewport: viewportSnapshot(),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: now.getTimezoneOffset(),
    localTime: now.toString(),
    localIsoTime: now.toISOString(),
    referrer: document.referrer || null,
    attribution,
    connection,
  };
}

function viewportSnapshot(): JsonObject {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

function urlAttribution(url: string, referrer: string): JsonObject {
  const currentUrl = safeUrl(url);
  const referrerUrl = referrer ? safeUrl(referrer) : null;
  const params = currentUrl?.searchParams ?? null;

  return {
    url,
    origin: currentUrl?.origin,
    path: currentUrl?.pathname,
    searchKeys: params ? [...params.keys()].sort() : [],
    hashPresent: currentUrl ? currentUrl.hash.length > 0 : false,
    referrer,
    referrerOrigin: referrerUrl?.origin,
    referrerPath: referrerUrl?.pathname,
    utm: params
      ? {
          source: params.get("utm_source"),
          medium: params.get("utm_medium"),
          campaign: params.get("utm_campaign"),
          term: params.get("utm_term"),
          content: params.get("utm_content"),
          id: params.get("utm_id"),
        }
      : null,
    identity: params
      ? {
          candidate: firstParam(params, ["candidate", "candidate_name"]),
          candidateId: firstParam(params, ["candidateId", "candidate_id"]),
          interviewId: firstParam(params, ["interviewId", "interview_id"]),
          participantId: firstParam(params, ["participantId", "participant_id"]),
          userId: firstParam(params, ["userId", "user_id"]),
          email: firstParam(params, ["email"]),
        }
      : null,
  };
}

function firstParam(params: URLSearchParams, names: string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value.length > 0) {
      return value;
    }
  }

  return null;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function connectionSnapshot(): JsonObject | null {
  const connection = (window.navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      downlink?: number;
      rtt?: number;
      saveData?: boolean;
    };
  }).connection;

  if (!connection) {
    return null;
  }

  return {
    effectiveType: connection.effectiveType,
    downlink: connection.downlink,
    rtt: connection.rtt,
    saveData: connection.saveData,
  };
}

function userAgentDataSnapshot(): JsonObject | null {
  const userAgentData = (window.navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{ brand: string; version: string }>;
      mobile?: boolean;
      platform?: string;
    };
  }).userAgentData;

  if (!userAgentData) {
    return null;
  }

  return {
    brands: userAgentData.brands?.map((brand) => ({
      brand: brand.brand,
      version: brand.version,
    })),
    mobile: userAgentData.mobile,
    platform: userAgentData.platform,
  };
}

function deviceSnapshot(): { deviceType: string; touchCapable: boolean } {
  const userAgent = window.navigator.userAgent;
  const touchCapable = window.navigator.maxTouchPoints > 0 || "ontouchstart" in window;
  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(userAgent) ||
    (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent));
  const isMobile = /Mobi|Android|iPhone|iPod|Windows Phone/i.test(userAgent) && !isTablet;

  return {
    deviceType: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
    touchCapable,
  };
}

function deviceMemory(): number | null {
  const value = (window.navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === "number" ? value : null;
}

function describeFormEvent(target: EventTarget | null): JsonObject {
  if (!(target instanceof HTMLElement)) {
    return { target: describeTarget(target) };
  }

  if (target instanceof HTMLInputElement) {
    return {
      target: describeTarget(target),
      value: target.type === "password" ? "[redacted]" : target.value,
      checked: target.checked,
      inputType: target.type,
    };
  }

  if (target instanceof HTMLTextAreaElement) {
    return {
      target: describeTarget(target),
      value: target.value,
    };
  }

  if (target instanceof HTMLSelectElement) {
    return {
      target: describeTarget(target),
      value: target.value,
    };
  }

  return { target: describeTarget(target) };
}

function safeKeyboardKey(event: KeyboardEvent): string {
  if (event.target instanceof HTMLInputElement && event.target.type === "password") {
    return "[redacted]";
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return "[text]";
  }

  return event.key;
}

function describeTarget(target: EventTarget | null): JsonObject {
  if (!(target instanceof HTMLElement)) {
    return { kind: target === null ? "null" : "non-element" };
  }

  const text = targetText(target);
  return {
    tag: target.tagName.toLowerCase(),
    id: target.id || undefined,
    className: target.className || undefined,
    role: target.getAttribute("role") ?? undefined,
    ariaLabel: target.getAttribute("aria-label") ?? undefined,
    name: target.getAttribute("name") ?? undefined,
    type: target.getAttribute("type") ?? undefined,
    text,
  };
}

function targetText(target: HTMLElement): string | undefined {
  if (
    target instanceof HTMLButtonElement ||
    target instanceof HTMLOptionElement ||
    target instanceof HTMLLabelElement ||
    target instanceof HTMLAnchorElement
  ) {
    const text = target.textContent?.replace(/\s+/g, " ").trim();
    return text && text.length > 120 ? `${text.slice(0, 120)}...` : text;
  }

  return undefined;
}

function throttle(callback: () => void, waitMs: number): () => void {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    const now = Date.now();
    const remaining = waitMs - (now - lastRun);
    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastRun = now;
      callback();
      return;
    }

    if (timer !== null) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      lastRun = Date.now();
      callback();
    }, remaining);
  };
}
