import { nativeUpdateNeeded } from './nativeUpdate';

const cfg = { latestVersionCode: 5, apkUrl: 'https://expo.dev/artifacts/eas/abc.apk' };

describe('nativeUpdateNeeded', () => {
  it('asks for the new APK when this build is older than the latest', () => {
    expect(nativeUpdateNeeded('4', cfg)).toEqual({ apkUrl: cfg.apkUrl, message: null });
    expect(nativeUpdateNeeded('4', { ...cfg, message: 'Adds camera fixes' })).toEqual({ apkUrl: cfg.apkUrl, message: 'Adds camera fixes' });
  });

  it('stays quiet when this build is current or newer', () => {
    expect(nativeUpdateNeeded('5', cfg)).toBeNull();
    expect(nativeUpdateNeeded('6', cfg)).toBeNull();
  });

  it('stays quiet when the version or the config is missing or malformed', () => {
    expect(nativeUpdateNeeded(null, cfg)).toBeNull();
    expect(nativeUpdateNeeded('abc', cfg)).toBeNull();
    expect(nativeUpdateNeeded('4', undefined)).toBeNull();
    expect(nativeUpdateNeeded('4', { latestVersionCode: '5', apkUrl: cfg.apkUrl })).toBeNull();
    expect(nativeUpdateNeeded('4', { latestVersionCode: 5 })).toBeNull();
  });

  it('only accepts an https download link', () => {
    expect(nativeUpdateNeeded('4', { ...cfg, apkUrl: 'http://evil.test/x.apk' })).toBeNull();
    expect(nativeUpdateNeeded('4', { ...cfg, apkUrl: 'javascript:alert(1)' })).toBeNull();
  });
});
