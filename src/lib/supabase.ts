import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase env vars missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
  );
}

export const supabase = createClient(url, anonKey);

/** True when the app has a cloud backend configured. Gated on the Supabase URL;
 *  callers use it to show/hide cloud-specific UI (export/import copy, etc.). */
export const isCloudConfigured = Boolean(url);

/** Generate a random uuid for a new row. The schema has no default for `id`,
 *  so every insert path must supply one. */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
