import { useCallback, useEffect, useRef, useState } from "react";

export type Role = "viewer" | "investigator" | "approver";

const ROLE_KEY = "drc.role"; // dev-only role switch (DRC_AUTH_MODE=dev); see api-contract.md
const ROLE_RANK: Record<Role, number> = { viewer: 0, investigator: 1, approver: 2 };

export function getRole(): Role {
  try {
    return (localStorage.getItem(ROLE_KEY) as Role | null) ?? "viewer";
  } catch {
    return "viewer";
  }
}

export function setRole(r: Role) {
  try {
    localStorage.setItem(ROLE_KEY, r);
  } catch {
    /* storage blocked: role resets on reload */
  }
}

export const canAct = (needed: Role, role: Role = getRole()) => ROLE_RANK[role] >= ROLE_RANK[needed];

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Human-readable message for any thrown value (never a raw "TypeError: …"). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something unexpected happened. Retry; if it keeps failing, reload the page.";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-DRC-Role": getRole(), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the API. Check your connection and that the API is running, then retry.");
  }
  if (!res.ok) {
    let msg = "";
    try {
      msg = (await res.json()).error?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    if (res.status >= 502 && res.status <= 504) msg = "The API is not responding. Check that it is running, then retry.";
    else if (res.status === 403) msg = msg || "Your role is not allowed to do this.";
    else if (res.status === 404) msg = msg || "This item does not exist (it may have been removed, or the link is wrong).";
    else if (res.status >= 500) msg = "The API failed while handling the request. Retry; if it keeps failing, check the API logs.";
    throw new ApiError(res.status, msg || `The request failed (HTTP ${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export type Load<T> =
  | { state: "loading" }
  | { state: "ok"; data: T; refreshing: boolean; updatedAt: Date; refreshError?: string }
  | { state: "denied"; message: string }
  | { state: "error"; message: string; status?: number };

/**
 * Fetch `path`. `reload()` refetches without dropping the data on screen (no flash to "loading").
 * With `pollWhile`, refetches every `intervalMs` while the predicate holds (e.g. status queued/running).
 */
export function useApi<T>(path: string, opts: { pollWhile?: (d: T) => boolean; intervalMs?: number } = {}): [Load<T>, () => void] {
  const [s, setS] = useState<Load<T>>({ state: "loading" });
  const [tick, setTick] = useState(0);
  const pollRef = useRef(opts.pollWhile);
  pollRef.current = opts.pollWhile;
  const pathRef = useRef(path);

  useEffect(() => {
    let live = true;
    const fresh = pathRef.current !== path;
    pathRef.current = path;
    setS((prev) => (prev.state === "ok" && !fresh ? { ...prev, refreshing: true } : { state: "loading" }));
    api<T>(path).then(
      (data) => live && setS({ state: "ok", data, refreshing: false, updatedAt: new Date() }),
      (e: unknown) => {
        if (!live) return;
        const message = errorMessage(e);
        setS((prev) => {
          if (prev.state === "ok" && !fresh) return { ...prev, refreshing: false, refreshError: message };
          if (e instanceof ApiError && e.status === 403) return { state: "denied", message };
          return { state: "error", message, status: e instanceof ApiError ? e.status : undefined };
        });
      },
    );
    return () => {
      live = false;
    };
  }, [path, tick]);

  // polling: schedule the next refetch only after the previous one landed
  useEffect(() => {
    if (s.state !== "ok" || s.refreshing || !pollRef.current?.(s.data)) return;
    const t = setTimeout(() => setTick((n) => n + 1), opts.intervalMs ?? 2000);
    return () => clearTimeout(t);
  }, [s, opts.intervalMs]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return [s, reload];
}

let lastUserAnnouncement = 0;

/** Announcement of a background status change; skipped right after a user-triggered announcement so the confirmation
 *  of the user's own action ("Decision recorded…") is not overwritten by the status poll that follows it. */
export function announceStatus(message: string) {
  if (Date.now() - lastUserAnnouncement < 5000) return;
  announce(message, false);
}

/** Polite screen-reader announcement through the app-level live region (#announcer). */
export function announce(message: string, fromUser = true) {
  if (fromUser) lastUserAnnouncement = Date.now();
  const el = document.getElementById("announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => (el.textContent = message), 50); // re-set so repeated messages are read again
}
