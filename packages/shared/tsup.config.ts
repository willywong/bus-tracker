import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/types/index.ts", "src/utils/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  clean: true,
  outDir: "dist",
  sourcemap: true,
  splitting: false,
});
