import { defineConfig } from "vite";
import terser from "@rollup/plugin-terser";
import dts from "vite-plugin-dts";
import pkg from "./package.json" with { type: "json" };

const external = Object.keys(pkg.peerDependencies || {});

export default defineConfig({
  plugins: [
    dts({
      outputDir: "dist",
      entryRoot: "src",
      insertTypesEntry: true,
      exclude: ["**/*.test.*"],
    }),
  ],
  build: {
    lib: {
      entry: "src/index.ts",
    },
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external,
      output: [
        {
          format: "cjs",
          entryFileNames: "index.js",
          exports: "named",
        },
        {
          format: "es",
          entryFileNames: "index.esm.js",
        },
        {
          format: "cjs",
          entryFileNames: "index.min.js",
          plugins: [terser()],
          exports: "named",
        },
        {
          format: "es",
          entryFileNames: "index.esm.min.js",
          plugins: [terser()],
        },
      ],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["tests/**", "dist/**", "coverage/**", "opensrc/**", "node_modules/**"],
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70,
    },
  },
});
