// Applies patches/ (see patches/expo-share-intent+*.patch). Skipped when the mobile app's packages aren't
// installed, e.g. the Netlify build installs only the server workspaces.
const { existsSync } = require('node:fs');
const { execSync } = require('node:child_process');

if (existsSync('node_modules/expo-share-intent')) execSync('npx patch-package', { stdio: 'inherit' });
