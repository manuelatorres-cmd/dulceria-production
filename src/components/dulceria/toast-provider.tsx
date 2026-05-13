"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Toast, type ToastItem, type ToastKind } from "./toast";

interface ToastOptions {
  description?: string;
}

interface ToastApi {
  success: (message: string, opts?: ToastOptions) => string;
  error: (message: string, opts?: ToastOptions) => string;
  warn: (message: string, opts?: ToastOptions) => string;
  info: (message: string, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
}

interface ToastContextValue {
  items: ToastItem[];
  toast: ToastApi;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  success: 4000,
  info: 4000,
  warn: 8000,
  error: null,
};

let counter = 0;
function newId(): string {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts?: ToastOptions): string => {
      const id = newId();
      const item: ToastItem = { id, kind, message, description: opts?.description };
      setItems((prev) => [...prev, item]);
      const dur = AUTO_DISMISS_MS[kind];
      if (dur != null) {
        const timer = setTimeout(() => dismiss(id), dur);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (msg, o) => push("success", msg, o),
      error: (msg, o) => push("error", msg, o),
      warn: (msg, o) => push("warn", msg, o),
      info: (msg, o) => push("info", msg, o),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ items, toast: api }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 100,
          pointerEvents: "none",
        }}
      >
        {items.map((t) => (
          <div key={t.id} style={{ pointerEvents: "auto" }}>
            <Toast item={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Hook to push toasts. Falls back to no-op outside provider so callers
 * can render outside the tree without crashing — useful for tests + SSR.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx.toast;
  return {
    success: () => "",
    error: () => "",
    warn: () => "",
    info: () => "",
    dismiss: () => undefined,
  };
}
