import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';
import { api } from '../lib/apiInstance';

export type ShareTarget = 'whatsapp' | 'any';

/** Thrown for any failure in the share flow; `message` is already user-facing. */
export class ShareFileError extends Error {}

const WHATSAPP_PACKAGE = 'com.whatsapp';
const ANDROID_ACTION_SEND = 'android.intent.action.SEND';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Strips characters that are illegal (or awkward) in a filesystem file name,
 * so the recipient sees a clean name like `PR-JEP-202609-001-YU WAI LOONG-30.00.pdf`
 * instead of something mangled by the OS.
 */
export function sanitizeFileName(name: string): string {
  const trimmed = (name ?? '').trim();
  // Windows/Android-illegal characters, plus control characters.
  const cleaned = trimmed
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'file';
}

/** Whether target 'whatsapp' should attempt the WhatsApp-specific intent on this platform. */
export function shouldAttemptWhatsappIntent(target: ShareTarget, platformOS: string): boolean {
  return target === 'whatsapp' && platformOS === 'android';
}

function friendlyDownloadError(status: number): string {
  if (status === 413) return 'This file is too large to share from the app. Please share it from Google Drive.';
  if (status === 403) return 'You do not have permission to access this file.';
  if (status === 401) return 'Please sign in again.';
  if (status === 404) return 'This file could not be found.';
  return `Could not download this file (${status}). Please try again.`;
}

async function downloadToCache(claimId: string, fileId: string, fileName: string): Promise<string> {
  const url = api.fileUrl(claimId, fileId);
  const headers = await api.authHeaders();
  const dest = `${FileSystem.cacheDirectory ?? ''}${fileName}`;

  let result: FileSystem.FileSystemDownloadResult;
  try {
    result = await FileSystem.downloadAsync(url, dest, { headers });
  } catch {
    throw new ShareFileError('Could not download this file. Please check your connection and try again.');
  }

  if (result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new ShareFileError(friendlyDownloadError(result.status));
  }

  return result.uri;
}

async function shareToWhatsapp(fileUri: string, mimeType: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync(ANDROID_ACTION_SEND, {
    type: mimeType,
    extra: { 'android.intent.extra.STREAM': contentUri },
    packageName: WHATSAPP_PACKAGE,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}

async function shareViaSheet(fileUri: string, mimeType: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new ShareFileError('Sharing is not available on this device.');
  await Sharing.shareAsync(fileUri, {
    mimeType,
    dialogTitle: 'Share',
    UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
  });
}

/**
 * Downloads a claim file (via the authorised file-proxy) into the app cache directory under its
 * original name, then shares it either straight to WhatsApp (Android) or via the system share sheet.
 * Falls back to the system share sheet when WhatsApp isn't installed or the intent fails.
 */
export async function shareClaimFile(opts: {
  claimId: string;
  fileId: string;
  name: string;
  mimeType: string;
  target: ShareTarget;
}): Promise<void> {
  const { claimId, fileId, name, mimeType, target } = opts;
  const fileUri = await downloadToCache(claimId, fileId, sanitizeFileName(name));

  if (shouldAttemptWhatsappIntent(target, Platform.OS)) {
    try {
      await shareToWhatsapp(fileUri, mimeType);
      return;
    } catch {
      // WhatsApp isn't installed, or the intent otherwise failed; fall back below.
    }
  }

  await shareViaSheet(fileUri, mimeType);
}

/**
 * Sends a plain-text message straight to WhatsApp: on Android via the WhatsApp-specific intent,
 * on iOS via the `whatsapp://send` URL scheme. Falls back to the system share sheet
 * (`Share.share`) whenever WhatsApp isn't installed or the WhatsApp-specific path fails.
 */
export async function shareTextToWhatsApp(text: string): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync(ANDROID_ACTION_SEND, {
        type: 'text/plain',
        extra: { 'android.intent.extra.TEXT': text },
        packageName: WHATSAPP_PACKAGE,
      });
      return;
    } catch {
      // WhatsApp isn't installed, or the intent otherwise failed; fall back below.
    }
    await Share.share({ message: text });
    return;
  }

  const url = `whatsapp://send?text=${encodeURIComponent(text)}`;
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Fall through to the share sheet below.
  }
  await Share.share({ message: text });
}
