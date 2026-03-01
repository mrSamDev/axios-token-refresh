import { describe, test, expect } from "vitest";
import { build as viteBuild } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import config from "../vite.config.mjs";

const requiredBuildFiles = [
  "index.js",
  "index.js.map",
  "index.esm.js",
  "index.esm.js.map",
  "index.min.js",
  "index.esm.min.js",
];

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

describe("build pipeline", () => {
  test(
    "emits expected artifacts",
    async () => {
      const outDir = path.join(os.tmpdir(), "axios-token-refresh-build");

      // Clean target dir in case a prior run left artifacts
      await fs.rm(outDir, { recursive: true, force: true });

      await viteBuild({
        ...config,
        build: {
          ...config.build,
          outDir,
        },
      });

      for (const file of requiredBuildFiles) {
        const exists = await fileExists(path.join(outDir, file));
        expect(exists).toBe(true);
      }

      // vite-plugin-dts is configured with outputDir: "dist" in vite.config.mjs
      const declarationExists = await fileExists(path.join(process.cwd(), "dist", "index.d.ts"));
      expect(declarationExists).toBe(true);
    },
    30000
  );
});
