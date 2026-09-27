/**
 * Publishing a new APK to Firestore `appConfig/android`, which the app reads to offer an in-app update
 * (see mobile/src/updates/nativeUpdate.ts). Used by scripts/publish-apk.mts.
 */

export interface ApkRelease {
  latestVersionCode: number;
  apkUrl: string;
  appVersion: string;
}

export interface AppConfigDoc {
  latestVersionCode: number;
  apkUrl: string;
  appVersion: string;
  /** Shown in the update prompt; null clears a previous release's note. */
  message: string | null;
}

/** Validates an `eas build:view --json` result and extracts what the app needs. Throws when it isn't releasable. */
export function apkConfigFromBuild(build: unknown): ApkRelease {
  const b = (build ?? {}) as Record<string, unknown>;
  if (b.status !== 'FINISHED') throw new Error(`Build ${String(b.id)} is ${String(b.status)}, not FINISHED`);
  if (b.platform !== 'ANDROID') throw new Error(`Build ${String(b.id)} is for ${String(b.platform)}, not ANDROID`);
  if (b.buildProfile !== 'production') throw new Error(`Build ${String(b.id)} uses the "${String(b.buildProfile)}" profile, not "production"`);
  const url = (b.artifacts as { buildUrl?: unknown } | undefined)?.buildUrl;
  if (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url)) throw new Error(`Build ${String(b.id)} has no https APK link`);
  const versionCode = Number(b.appBuildVersion);
  if (!Number.isInteger(versionCode) || versionCode <= 0) throw new Error(`Build ${String(b.id)} has no valid versionCode`);
  return { latestVersionCode: versionCode, apkUrl: url, appVersion: String(b.appVersion ?? '') };
}

/** The document to write. Refuses to move to an older or equal build (that would prompt nobody, or downgrade) unless forced. */
export function nextAppConfig(
  current: Record<string, unknown> | undefined,
  release: ApkRelease,
  message: string | undefined,
  opts: { force?: boolean } = {},
): AppConfigDoc {
  const currentCode = typeof current?.latestVersionCode === 'number' ? current.latestVersionCode : 0;
  if (!opts.force && release.latestVersionCode <= currentCode) {
    throw new Error(`Build ${release.latestVersionCode} is not newer than the published ${currentCode}; use --force to override`);
  }
  const note = message?.trim();
  return { ...release, message: note ? note : null };
}
