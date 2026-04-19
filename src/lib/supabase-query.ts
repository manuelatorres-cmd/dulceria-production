import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Unwrap a Supabase response that MUST contain data: return data on success,
 * throw on error OR on null data. Use for array selects, inserts, updates.
 */
export function assertOk<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw result.error;
  if (result.data === null) {
    throw new Error("Supabase returned null data with no error");
  }
  return result.data;
}

/**
 * Unwrap a Supabase response that MAY be empty: return data or null on success,
 * throw only on error. Use for `.maybeSingle()` lookups where absence is valid.
 */
export function assertOkMaybe<T>(result: { data: T | null; error: PostgrestError | null }): T | null {
  if (result.error) throw result.error;
  return result.data;
}
