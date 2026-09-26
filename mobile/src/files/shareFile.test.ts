let mockPlatformOS: 'android' | 'ios' = 'android';
const mockShareShare = jest.fn(async (_content: { message: string }) => ({ action: 'sharedAction' }));
let mockCanOpenURL = jest.fn(async (_url: string) => true);
const mockOpenURL = jest.fn(async (_url: string) => undefined);

jest.mock('react-native', () => ({
  get Platform() {
    return { OS: mockPlatformOS };
  },
  Share: { share: (content: { message: string }) => mockShareShare(content) },
  Linking: {
    canOpenURL: (url: string) => mockCanOpenURL(url),
    openURL: (url: string) => mockOpenURL(url),
  },
}));

let mockDownloadResult: { status: number; uri: string };
let mockDownloadError: Error | null = null;
const mockDownloadAsync = jest.fn(async (_url: string, _dest: string, _options: unknown) => {
  if (mockDownloadError) throw mockDownloadError;
  return mockDownloadResult;
});
const mockDeleteAsync = jest.fn(async (_uri: string, _options: unknown) => undefined);
const mockGetContentUriAsync = jest.fn(async (uri: string) => `content://${uri}`);

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  downloadAsync: (url: string, dest: string, options: unknown) => mockDownloadAsync(url, dest, options),
  deleteAsync: (uri: string, options: unknown) => mockDeleteAsync(uri, options),
  getContentUriAsync: (uri: string) => mockGetContentUriAsync(uri),
}));

let mockIntentError: Error | null = null;
const mockStartActivityAsync = jest.fn(async (_action: string, _params: unknown) => {
  if (mockIntentError) throw mockIntentError;
  return { resultCode: -1 };
});

jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (action: string, params: unknown) => mockStartActivityAsync(action, params),
}));

const mockIsAvailableAsync = jest.fn(async () => true);
const mockShareAsync = jest.fn(async (_uri: string, _options: unknown) => undefined);

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (uri: string, options: unknown) => mockShareAsync(uri, options),
}));

const mockFileUrl = jest.fn((claimId: string, fileId: string) => `https://api.example/file?claimId=${claimId}&fileId=${fileId}`);
const mockAuthHeaders = jest.fn(async () => ({ Authorization: 'Bearer token' }));

jest.mock('../lib/apiInstance', () => ({
  api: {
    fileUrl: (claimId: string, fileId: string) => mockFileUrl(claimId, fileId),
    authHeaders: () => mockAuthHeaders(),
  },
}));

import { sanitizeFileName, shareClaimFile, shareTextToWhatsApp, ShareFileError, shouldAttemptWhatsappIntent } from './shareFile';

describe('sanitizeFileName', () => {
  it('replaces filesystem-illegal characters', () => {
    expect(sanitizeFileName('PR-JEP-202609-001/YU:WAI*LOONG?-30.00.pdf')).toBe('PR-JEP-202609-001_YU_WAI_LOONG_-30.00.pdf');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeFileName('  My   Receipt   Name.png  ')).toBe('My Receipt Name.png');
  });

  it('falls back to a default name for an empty/blank input', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('leaves an already-clean name untouched', () => {
    expect(sanitizeFileName('claim.pdf')).toBe('claim.pdf');
  });
});

describe('shouldAttemptWhatsappIntent', () => {
  it('is true only for target "whatsapp" on android', () => {
    expect(shouldAttemptWhatsappIntent('whatsapp', 'android')).toBe(true);
    expect(shouldAttemptWhatsappIntent('whatsapp', 'ios')).toBe(false);
    expect(shouldAttemptWhatsappIntent('any', 'android')).toBe(false);
    expect(shouldAttemptWhatsappIntent('any', 'ios')).toBe(false);
  });
});

describe('shareClaimFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDownloadResult = { status: 200, uri: 'file:///cache/claim.pdf' };
    mockDownloadError = null;
    mockIntentError = null;
    mockIsAvailableAsync.mockResolvedValue(true);
  });

  const call = (target: 'whatsapp' | 'any' = 'whatsapp') =>
    shareClaimFile({ claimId: 'c1', fileId: 'f1', name: 'claim.pdf', mimeType: 'application/pdf', target });

  it('downloads with the auth header into the cache directory under the sanitised name', async () => {
    await call('any');
    expect(mockDownloadAsync).toHaveBeenCalledWith(
      'https://api.example/file?claimId=c1&fileId=f1',
      'file:///cache/claim.pdf',
      { headers: { Authorization: 'Bearer token' } },
    );
  });

  it('shares straight to WhatsApp via the intent when it succeeds on android', async () => {
    await call('whatsapp');
    expect(mockGetContentUriAsync).toHaveBeenCalledWith('file:///cache/claim.pdf');
    expect(mockStartActivityAsync).toHaveBeenCalledWith('android.intent.action.SEND', {
      type: 'application/pdf',
      extra: { 'android.intent.extra.STREAM': 'content://file:///cache/claim.pdf' },
      packageName: 'com.whatsapp',
      flags: 1,
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('falls back to the share sheet when the WhatsApp intent throws (e.g. not installed)', async () => {
    mockIntentError = new Error('ActivityNotFoundException');
    await call('whatsapp');
    expect(mockStartActivityAsync).toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalledWith('file:///cache/claim.pdf', {
      mimeType: 'application/pdf',
      dialogTitle: 'Share',
      UTI: 'com.adobe.pdf',
    });
  });

  it('uses the share sheet directly for target "any"', async () => {
    await call('any');
    expect(mockStartActivityAsync).not.toHaveBeenCalled();
    expect(mockShareAsync).toHaveBeenCalled();
  });

  it('surfaces a friendly message and cleans up the partial file for a 413 response', async () => {
    mockDownloadResult = { status: 413, uri: 'file:///cache/claim.pdf' };
    await expect(call('any')).rejects.toThrow(ShareFileError);
    await expect(call('any')).rejects.toThrow(/too large to share from the app/);
    expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/claim.pdf', { idempotent: true });
  });

  it('surfaces a friendly message for a 403 response', async () => {
    mockDownloadResult = { status: 403, uri: 'file:///cache/claim.pdf' };
    await expect(call('any')).rejects.toThrow(/do not have permission/);
  });

  it('surfaces a friendly message when the download itself throws (e.g. network failure)', async () => {
    mockDownloadError = new Error('network down');
    await expect(call('any')).rejects.toThrow(ShareFileError);
    await expect(call('any')).rejects.toThrow(/check your connection/);
  });
});

describe('shareTextToWhatsApp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'android';
    mockIntentError = null;
    mockCanOpenURL = jest.fn(async (_url: string) => true);
  });

  it('sends the text via the WhatsApp intent on android when it succeeds', async () => {
    await shareTextToWhatsApp('hello there');
    expect(mockStartActivityAsync).toHaveBeenCalledWith('android.intent.action.SEND', {
      type: 'text/plain',
      extra: { 'android.intent.extra.TEXT': 'hello there' },
      packageName: 'com.whatsapp',
    });
    expect(mockShareShare).not.toHaveBeenCalled();
  });

  it('falls back to Share.share on android when the WhatsApp intent throws', async () => {
    mockIntentError = new Error('ActivityNotFoundException');
    await shareTextToWhatsApp('hello there');
    expect(mockStartActivityAsync).toHaveBeenCalled();
    expect(mockShareShare).toHaveBeenCalledWith({ message: 'hello there' });
  });

  it('opens the whatsapp:// URL on iOS when it can be opened', async () => {
    mockPlatformOS = 'ios';
    await shareTextToWhatsApp('hello there');
    expect(mockCanOpenURL).toHaveBeenCalledWith('whatsapp://send?text=hello%20there');
    expect(mockOpenURL).toHaveBeenCalledWith('whatsapp://send?text=hello%20there');
    expect(mockShareShare).not.toHaveBeenCalled();
  });

  it('falls back to Share.share on iOS when the whatsapp:// URL cannot be opened', async () => {
    mockPlatformOS = 'ios';
    mockCanOpenURL = jest.fn(async (_url: string) => false);
    await shareTextToWhatsApp('hello there');
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(mockShareShare).toHaveBeenCalledWith({ message: 'hello there' });
  });

  it('falls back to Share.share on iOS when canOpenURL itself throws', async () => {
    mockPlatformOS = 'ios';
    mockCanOpenURL = jest.fn(async (_url: string) => {
      throw new Error('boom');
    });
    await shareTextToWhatsApp('hello there');
    expect(mockShareShare).toHaveBeenCalledWith({ message: 'hello there' });
  });
});
