import { QueryClient } from "@tanstack/react-query";

/** Module-scoped QueryClient singleton. Imported both by the React provider
 *  and by non-component mutation functions in hooks.ts so the latter can
 *  invalidate cached queries after writes. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});
