import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { ApkInstallError, downloadAndInstallApk } from './installApk';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(async () => undefined),
  makeDirectoryAsync: jest.fn(async () => undefined),
  createDownloadResumable: jest.fn(),
  getContentUriAsync: jest.fn(async (uri: string) => uri.replace('file:///cache/', 'content://jep/cache/')),
}));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => ({})) }));

const fs = FileSystem as jest.Mocked<typeof FileSystem>;
const launcher = IntentLauncher as jest.Mocked<typeof IntentLauncher>;

function downloadReturning(result: { status: number; uri: string } | Error, progress: [number, number][] = []) {
  (fs.createDownloadResumable as jest.Mock).mockImplementation((_url, _target, _opts, cb) => ({
    downloadAsync: async () => {
      for (const [written, total] of progress) cb({ totalBytesWritten: written, totalBytesExpectedToWrite: total });
      if (result instanceof Error) throw result;
      return result;
    },
  }));
}

describe('downloadAndInstallApk', () => {
  beforeEach(() => jest.clearAllMocks());

  it('downloads into a fresh cache folder, reports progress, and opens the package installer', async () => {
    downloadReturning({ status: 200, uri: 'file:///cache/apk/jep-claims.apk' }, [[25, 100], [100, 100]]);
    const progress: number[] = [];
    await downloadAndInstallApk('https://expo.dev/a.apk', (f) => progress.push(f));

    expect(fs.deleteAsync).toHaveBeenCalledWith('file:///cache/apk/', { idempotent: true });
    expect((fs.createDownloadResumable as jest.Mock).mock.calls[0]![0]).toBe('https://expo.dev/a.apk');
    expect(progress).toEqual([0.25, 1, 1]);
    expect(launcher.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'content://jep/cache/apk/jep-claims.apk',
      type: 'application/vnd.android.package-archive',
      flags: 1,
    });
  });

  it('fails with a friendly error on a bad download, without opening the installer', async () => {
    downloadReturning({ status: 404, uri: 'file:///cache/apk/jep-claims.apk' });
    await expect(downloadAndInstallApk('https://expo.dev/a.apk', () => {})).rejects.toBeInstanceOf(ApkInstallError);
    downloadReturning(new Error('offline'));
    await expect(downloadAndInstallApk('https://expo.dev/a.apk', () => {})).rejects.toThrow('internet connection');
    expect(launcher.startActivityAsync).not.toHaveBeenCalled();
  });

  it('reports when the installer cannot be opened', async () => {
    downloadReturning({ status: 200, uri: 'file:///cache/apk/jep-claims.apk' });
    launcher.startActivityAsync.mockRejectedValueOnce(new Error('No activity'));
    await expect(downloadAndInstallApk('https://expo.dev/a.apk', () => {})).rejects.toThrow('browser');
  });
});
