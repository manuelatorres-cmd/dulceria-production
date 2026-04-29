"use client";

import { useEffect } from "react";

/**
 * Global focus delegate: whenever a `<input type="date">` or
 * `<input type="datetime-local">` (or `time`, `month`, `week`) gains
 * focus, immediately call `showPicker()` so the calendar / picker
 * opens without a separate click on the icon. Native picker is the
 * stock browser one — no extra UI dependency.
 *
 * Mounted once at the (app) layout level. No-op on browsers that
 * don't support `showPicker` (older Safari).
 */
export function DatePickerAutoOpen() {
  useEffect(() => {
    function handler(e: FocusEvent) {
      const t = e.target as HTMLInputElement | null;
      if (!t || t.tagName !== "INPUT") return;
      const type = t.type;
      if (type !== "date" && type !== "datetime-local" && type !== "time" && type !== "month" && type !== "week") return;
      // Ignore disabled / readonly fields.
      if (t.disabled || t.readOnly) return;
      const fn = (t as HTMLInputElement & { showPicker?: () => void }).showPicker;
      if (typeof fn === "function") {
        try { fn.call(t); } catch { /* user gesture missing — fail silently */ }
      }
    }
    document.addEventListener("focusin", handler, true);
    document.addEventListener("click", handler, true);
    return () => {
      document.removeEventListener("focusin", handler, true);
      document.removeEventListener("click", handler, true);
    };
  }, []);
  return null;
}
