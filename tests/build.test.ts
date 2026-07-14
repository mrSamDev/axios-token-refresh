import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, test, expect } from 'vitest';

const requiredBuildFiles = ['index.mjs', 'index.cjs', 'index.d.cts', 'index.d.mts'];

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

describe('build pipeline', () => {
  test('emits expected artifacts', async () => {
    const outDir = path.join(os.tmpdir(), 'axios-token-refresh-build');

    // Clean target dir in case a prior run left artifacts
    await fs.rm(outDir, { recursive: true, force: true });

    execSync(`pnpm exec tsdown --out-dir ${outDir}`, {
      stdio: 'pipe',
    });

    for (const file of requiredBuildFiles) {
      const exists = await fileExists(path.join(outDir, file));
      expect(exists).toBe(true);
    }
  }, 30000);
});
