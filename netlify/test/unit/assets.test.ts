import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { resolveAsset } from '../../lib/assets';

describe('resolveAsset', () => {
  let tempDir: string;
  const originalLambdaTaskRoot = process.env.LAMBDA_TASK_ROOT;

  afterEach(() => {
    process.env.LAMBDA_TASK_ROOT = originalLambdaTaskRoot;
  });

  it('finds files under netlify/assets when packaged with netlify prefix', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'assets-test-'));
    const assetDir = path.join(tempDir, 'netlify', 'assets');
    await mkdir(assetDir, { recursive: true });
    const logoPath = path.join(assetDir, 'logo-black.png');
    await writeFile(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    process.env.LAMBDA_TASK_ROOT = tempDir;

    const resolved = resolveAsset('netlify/assets/logo-black.png');
    expect(resolved).toBe(logoPath);
  });

  it('finds files under assets when packaged without netlify prefix', async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'assets-test-'));
    const assetDir = path.join(tempDir, 'assets');
    await mkdir(assetDir, { recursive: true });
    const logoPath = path.join(assetDir, 'logo-black.png');
    await writeFile(logoPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    process.env.LAMBDA_TASK_ROOT = tempDir;

    const resolved = resolveAsset('netlify/assets/logo-black.png');
    expect(resolved).toBe(logoPath);
  });
});
