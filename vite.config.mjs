import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import pkg from "./package.json" with { type: "json" };

const external = Object.keys(pkg.peerDependencies || {});

export default defineConfig({
  plugins: [
    dts({
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
    sourcemap: false,
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
