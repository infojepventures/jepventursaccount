import TextRecognition, { TextRecognitionScript } from '@react-native-ml-kit/text-recognition';

/** Matches the server's cap on `AnalyzeAttachmentRequest.text`. */
const MAX_OCR_TEXT_CHARS = 20_000;

function clean(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim().slice(0, MAX_OCR_TEXT_CHARS);
  return trimmed.length ? trimmed : null;
}

/**
 * Runs on-device OCR (Google ML Kit) on a local image file. Tries the Chinese script first
 * (it also reads Latin text), then falls back to Latin-only on error or an empty result.
 * Never throws; returns null when nothing could be read.
 */
export async function recognizeText(uri: string): Promise<string | null> {
  try {
    const result = await TextRecognition.recognize(uri, TextRecognitionScript.CHINESE);
    const text = clean(result.text);
    if (text) return text;
  } catch {
    // fall through to the Latin-only attempt below
  }
  try {
    const result = await TextRecognition.recognize(uri, TextRecognitionScript.LATIN);
    return clean(result.text);
  } catch {
    return null;
  }
}
