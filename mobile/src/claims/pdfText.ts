import { extractText, isAvailable } from 'expo-pdf-text-extract';

/** Same cap as on-device photo OCR text. */
const MAX_TEXT_CHARS = 20_000;

/**
 * Reads the embedded text of a PDF on the device (PDFBox on Android, sorted by position). Returns null when
 * the native module is missing, the file can't be read, or it has no text layer (a scanned PDF), so the
 * caller can fall back to the server after upload. Never throws.
 */
export async function extractPdfText(uri: string): Promise<string | null> {
  try {
    if (!isAvailable()) return null;
    const text = (await extractText(uri)).replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT_CHARS);
    return text.length ? text : null;
  } catch {
    return null;
  }
}
