import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text", "json-summary"],
      // A payment SDK: keep every line exercised. `npm run coverage` fails below these.
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 95 },
    },
  },
});
