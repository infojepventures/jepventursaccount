/**
 * Publishes an APK built on EAS to Firestore `appConfig/android`, so older app builds offer the in-app update.
 *
 *   npm run publish:apk -w @jep/netlify                          # latest finished production Android build
 *   npm run publish:apk -w @jep/netlify -- --build <id>          # a specific build
 *   npm run publish:apk -w @jep/netlify -- --message "What's new" [--force] [--dry-run]
 *
 * Needs netlify/.env (Firebase service account) and an `eas login` session.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { apkConfigFromBuild, nextAppConfig } from '../lib/appRelease';
import { getAdminApp } from '../lib/firebaseAdmin';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mobile');
// build:view has no --non-interactive flag (it never prompts).
const eas = (cmd: string, interactiveFlag = true) =>
  execSync(`npx --yes eas-cli@latest ${cmd} --json${interactiveFlag ? ' --non-interactive' : ''}`, {
    cwd: mobileDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });

const buildId = option('build');
const raw = buildId
  ? JSON.parse(eas(`build:view ${buildId}`, false))
  : JSON.parse(eas('build:list --platform android --status finished --build-profile production --limit 1'))[0];
if (!raw) throw new Error('No finished production Android build found on EAS');
const release = apkConfigFromBuild(raw);
console.log(`Build ${raw.id}: version ${release.appVersion} (versionCode ${release.latestVersionCode})`);

const head = await fetch(release.apkUrl, { method: 'HEAD', redirect: 'follow' });
if (!head.ok) throw new Error(`The APK link answered ${head.status}; not publishing`);
const size = Number(head.headers.get('content-length') ?? 0);
if (size) console.log(`APK size: ${(size / 1e6).toFixed(1)} MB`);

const ref = getFirestore(getAdminApp()).doc('appConfig/android');
const current = (await ref.get()).data();
const next = nextAppConfig(current, release, option('message'), { force: flag('force') });
console.log(`appConfig/android: versionCode ${String(current?.latestVersionCode ?? 'none')} -> ${next.latestVersionCode}`);

if (flag('dry-run')) {
  console.log('Dry run: nothing written.', next);
} else {
  await ref.set({ ...next, updatedAt: FieldValue.serverTimestamp() });
  console.log('✔ Published. Older builds will offer the update the next time they open the app.');
}
