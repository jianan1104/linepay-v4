import { defineConfig } from "tsdown";

// ESM + CJS, each with its own type declarations. Declarations come from
// oxc's isolated-declarations transform (tsconfig: isolatedDeclarations), so
// the build doesn't need TypeScript's JS API — TypeScript 7 only type-checks.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "node",
});
