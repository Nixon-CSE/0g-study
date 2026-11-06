import path from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig's `jsx: preserve` is for Next; tests that render a component need it compiled.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"] },
});
