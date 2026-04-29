"use client";

import { useEffect } from "react";

/** PostgREST errors come back as a plain object `{ message, code,
 *  details, hint }`. Throwing them as-is makes Next's dev overlay
 *  show "[object Object]" — unhelpful. Wrap any such rejection into
 *  a real Error with a readable combined message so the overlay and
 *  console print the actual cause. */
function wrapPostgrestReason(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (reason && typeof reason === "object") {
    const r = reason as { message?: string; code?: string; details?: string; hint?: string };
    const parts = [
      r.message ?? "Unknown error",
      r.code ? `(code ${r.code})` : "",
      r.details ? `— ${r.details}` : "",
      r.hint ? `· hint: ${r.hint}` : "",
    ].filter(Boolean);
    const e = new Error(parts.join(" "));
    // Preserve original for inspection in console.
    (e as Error & { cause?: unknown }).cause = reason;
    return e;
  }
  return new Error(String(reason));
}

export function GlobalErrorHandler() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      console.error("Unhandled error:", event.error ?? event.message);
    }
    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const wrapped = wrapPostgrestReason(event.reason);
      // Log the human-readable message alongside the raw object so the
      // console shows both. No re-throw — the setTimeout dance created
      // a second overlay firing on top of the first.
      console.error("Unhandled promise rejection:", wrapped.message, event.reason);
    }
    // Select-all on focus for number inputs so typing replaces the existing value
    // rather than appending to it (e.g. avoids "02" when editing a "0" field).
    function onFocusIn(event: FocusEvent) {
      if (event.target instanceof HTMLInputElement && event.target.type === "number") {
        event.target.select();
      }
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  return null;
}
