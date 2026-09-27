import { describe, expect, it } from 'vitest';
import { apkConfigFromBuild, nextAppConfig } from '../../lib/appRelease';

const build = {
  id: 'b1',
  status: 'FINISHED',
  platform: 'ANDROID',
  buildProfile: 'production',
  appVersion: '1.1.0',
  appBuildVersion: '8',
  artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/abc.apk' },
};

describe('apkConfigFromBuild', () => {
  it('reads the versionCode and APK link of a finished production Android build', () => {
    expect(apkConfigFromBuild(build)).toEqual({ latestVersionCode: 8, apkUrl: 'https://expo.dev/artifacts/eas/abc.apk', appVersion: '1.1.0' });
  });

  it.each([
    ['not finished', { ...build, status: 'IN_PROGRESS' }],
    ['not Android', { ...build, platform: 'IOS' }],
    ['not the production profile', { ...build, buildProfile: 'development' }],
    ['no APK link', { ...build, artifacts: {} }],
    ['a non-https link', { ...build, artifacts: { buildUrl: 'http://x.test/a.apk' } }],
    ['a bad versionCode', { ...build, appBuildVersion: 'x' }],
  ])('refuses a build that is %s', (_why, b) => {
    expect(() => apkConfigFromBuild(b)).toThrow();
  });
});

describe('nextAppConfig', () => {
  const release = { latestVersionCode: 8, apkUrl: 'https://expo.dev/artifacts/eas/abc.apk', appVersion: '1.1.0' };

  it('publishes a newer build, with an optional message (dropping a stale one)', () => {
    expect(nextAppConfig({ latestVersionCode: 5, apkUrl: 'https://old', message: 'old note' }, release, undefined)).toEqual({
      latestVersionCode: 8,
      apkUrl: release.apkUrl,
      appVersion: '1.1.0',
      message: null,
    });
    expect(nextAppConfig(undefined, release, '  Faster receipt reading  ').message).toBe('Faster receipt reading');
  });

  it('refuses to go back to (or re-publish) an older or equal build unless forced', () => {
    expect(() => nextAppConfig({ latestVersionCode: 8 }, release, undefined)).toThrow('not newer');
    expect(() => nextAppConfig({ latestVersionCode: 9 }, release, undefined)).toThrow('not newer');
    expect(nextAppConfig({ latestVersionCode: 9 }, release, undefined, { force: true }).latestVersionCode).toBe(8);
  });
});
