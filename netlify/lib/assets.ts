import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PdfAssets {
  fontBytes: Uint8Array;
  logoPng: Uint8Array;
}

// Paths are relative to the repo root; netlify.toml ships them via `included_files`.
export const FONT_REL = 'netlify/assets/fonts/NotoSansSC-VF.ttf';
export const LOGO_REL = 'netlify/assets/logo-black.png';

export function resolveAsset(rel: string): string | null {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), path.resolve(process.cwd(), '..')].filter(
    (r): r is string => !!r,
  );
  for (const root of roots) {
    const p = path.join(root, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

let cache: Promise<PdfAssets> | null = null;

export function loadPdfAssets(): Promise<PdfAssets> {
  cache ??= (async () => {
    const font = resolveAsset(FONT_REL);
    const logo = resolveAsset(LOGO_REL);
    if (!font || !logo) {
      throw new Error(`PDF assets missing (font: ${font}, logo: ${logo}, cwd: ${process.cwd()})`);
    }
    return { fontBytes: new Uint8Array(await readFile(font)), logoPng: new Uint8Array(await readFile(logo)) };
  })();
  return cache;
}
