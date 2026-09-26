import TextRecognition, { TextRecognitionScript, type TextRecognitionResult } from '@react-native-ml-kit/text-recognition';

/** Matches the server's cap on `AnalyzeAttachmentRequest.text`. */
const MAX_OCR_TEXT_CHARS = 20_000;

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim().slice(0, MAX_OCR_TEXT_CHARS);
  return trimmed.length ? trimmed : null;
}

/**
 * ML Kit orders text block by block, which on table-style receipts often emits whole columns one after
 * another ("Grand Total" far away from "439.55"). Rebuild visual rows from the line frames instead:
 * lines whose vertical centres are within half a line height share a row, read left to right.
 * Falls back to `result.text` when frames are missing.
 */
export function layoutText(result: TextRecognitionResult): string {
  const lines = result.blocks.flatMap((b) => b.lines).filter((l) => l.frame && l.text.trim());
  if (lines.length === 0 || lines.length !== result.blocks.flatMap((b) => b.lines).length) return result.text;

  const items = lines
    .map((l) => ({ text: l.text.trim(), left: l.frame!.left, mid: l.frame!.top + l.frame!.height / 2, h: l.frame!.height }))
    .sort((a, b) => a.mid - b.mid);

  const rows: (typeof items)[] = [];
  for (const item of items) {
    const row = rows[rows.length - 1];
    const rowMid = row ? row.reduce((s, i) => s + i.mid, 0) / row.length : 0;
    const rowH = row ? row.reduce((s, i) => s + i.h, 0) / row.length : 0;
    if (row && Math.abs(item.mid - rowMid) <= Math.max(rowH, item.h) / 2) row.push(item);
    else rows.push([item]);
  }
  return rows.map((r) => r.sort((a, b) => a.left - b.left).map((i) => i.text).join(' ')).join('\n');
}

async function recognize(uri: string, script: TextRecognitionScript): Promise<string | null> {
  const text = clean(layoutText(await TextRecognition.recognize(uri, script)));
  if (__DEV__) console.log(`[ocr] ${script} text:\n${text ?? '(none)'}`);
  return text;
}

/**
 * Runs on-device OCR (Google ML Kit) on a local image file. Tries the Chinese script first
 * (it also reads Latin text), then falls back to Latin-only on error or an empty result.
 * Never throws; returns null when nothing could be read.
 */
export async function recognizeText(uri: string): Promise<string | null> {
  try {
    const text = await recognize(uri, TextRecognitionScript.CHINESE);
    if (text) return text;
  } catch {
    // fall through to the Latin-only attempt below
  }
  try {
    return await recognize(uri, TextRecognitionScript.LATIN);
  } catch {
    return null;
  }
}
