import { useEffect, useState } from "react";

export type Role = "viewer" | "investigator" | "approver";

const ROLE_KEY = "drc.role"; // dev-only role switch (DRC_AUTH_MODE=dev); see api-contract.md

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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-DRC-Role": getRole(), ...init.headers },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    if (res.status >= 502 && res.status <= 504) msg = `API unreachable (HTTP ${res.status}). Is the API running?`;
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export type Load<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "denied"; message: string }
  | { state: "error"; message: string; status?: number };

export function useApi<T>(path: string, reloadKey = 0): Load<T> {
  const [s, setS] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setS({ state: "loading" });
    api<T>(path).then(
      (data) => live && setS({ state: "ok", data }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403) setS({ state: "denied", message: e.message });
        else setS({ state: "error", message: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : undefined });
      },
    );
    return () => {
      live = false;
    };
  }, [path, reloadKey]);
  return s;
}
