"use client";

import { useEffect } from "react";

/**
 * Global Enter-key advance: pressing Enter inside a single-line input
 * or a select moves focus to the next focusable form field instead of
 * submitting / doing nothing. Textareas keep native newline behavior.
 *
 * Mounted once at the (app) layout level alongside DatePickerAutoOpen.
 */
const FOCUSABLE = [
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
  "button:not([disabled])",
].join(",");

export function EnterAdvancesFocus() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "Enter") return;
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;

      const tag = t.tagName;
      if (tag === "TEXTAREA") return;
      if (tag === "BUTTON") return;
      if (tag === "INPUT") {
        const type = (t as HTMLInputElement).type;
        // Submit-like inputs and checkboxes/radios keep native behavior.
        if (
          type === "submit" || type === "button" || type === "checkbox"
          || type === "radio" || type === "file" || type === "image"
          || type === "reset"
        ) return;
      } else if (tag !== "SELECT") {
        return;
      }

      e.preventDefault();
      const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
      const idx = all.indexOf(t);
      if (idx === -1) return;
      for (let i = idx + 1; i < all.length; i++) {
        const next = all[i];
        if (next.tagName === "BUTTON") continue;
        next.focus();
        if (next.tagName === "INPUT" || next.tagName === "TEXTAREA") {
          (next as HTMLInputElement).select?.();
        }
        return;
      }
    }
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, []);
  return null;
}
