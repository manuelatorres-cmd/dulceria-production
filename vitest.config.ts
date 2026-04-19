import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Unit tests don't hit Supabase — these placeholders just satisfy the
      // fail-fast check in src/lib/supabase.ts so modules that import it
      // (e.g. spreadsheet-import-*.ts) can load in the test environment.
      NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
