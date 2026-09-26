import { checkForUpdates, type UpdateCheckDeps } from './checkForUpdates';

const apk = { latestVersionCode: 9, apkUrl: 'https://expo.dev/a.apk' };
const deps = (over: Partial<UpdateCheckDeps> = {}): UpdateCheckDeps => ({
  otaEnabled: true,
  checkOta: async () => ({ isAvailable: false }),
  fetchOta: async () => undefined,
  currentVersionCode: '3',
  loadNativeConfig: async () => ({ latestVersionCode: 3, apkUrl: 'https://expo.dev/a.apk' }),
  ...over,
});

describe('checkForUpdates', () => {
  it('reports a required APK first (an over-the-air update would not reach an old build anyway)', async () => {
    const fetchOta = jest.fn();
    const r = await checkForUpdates(deps({ loadNativeConfig: async () => apk, checkOta: async () => ({ isAvailable: true }), fetchOta }));
    expect(r).toEqual({ kind: 'native', update: { apkUrl: apk.apkUrl, message: null } });
    expect(fetchOta).not.toHaveBeenCalled();
  });

  it('downloads an available over-the-air update and says it is ready to apply', async () => {
    const fetchOta = jest.fn(async () => undefined);
    expect(await checkForUpdates(deps({ checkOta: async () => ({ isAvailable: true }), fetchOta }))).toEqual({ kind: 'otaReady' });
    expect(fetchOta).toHaveBeenCalledTimes(1);
  });

  it('says it is up to date when neither is available', async () => {
    expect(await checkForUpdates(deps())).toEqual({ kind: 'latest' });
  });

  it('skips the over-the-air check where updates are disabled (development builds)', async () => {
    const checkOta = jest.fn();
    expect(await checkForUpdates(deps({ otaEnabled: false, checkOta }))).toEqual({ kind: 'latest' });
    expect(checkOta).not.toHaveBeenCalled();
  });

  it('still checks for an over-the-air update when the APK config cannot be read', async () => {
    const r = await checkForUpdates(deps({ loadNativeConfig: async () => { throw new Error('offline'); }, checkOta: async () => ({ isAvailable: true }) }));
    expect(r).toEqual({ kind: 'otaReady' });
  });

  it('reports an error when the over-the-air check fails and nothing else was found', async () => {
    const r = await checkForUpdates(deps({ checkOta: async () => { throw new Error('offline'); } }));
    expect(r).toEqual({ kind: 'error' });
  });
});
