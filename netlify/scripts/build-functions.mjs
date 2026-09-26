// Pre-bundles every Netlify function (and its @jep/shared / netlify/lib
// dependencies) into a single, plain-JS ESM file per function.
//
// Why: Netlify's own zip-it-and-ship-it bundler (esbuild mode) was producing,
// for any function that imports @jep/shared, TWO zip entries at the same
// path `netlify/functions/<name>.mjs` — the function's own bundle and a
// separate bundle of @jep/shared — so extraction let one silently overwrite
// the other. Bundling here ourselves means Netlify only has to zip up
// already-fully-inlined, standalone files: nothing left for it to bundle,
// nothing left for it to duplicate.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const netlifyRoot = path.resolve(__dirname, '..');
const functionsDir = path.join(netlifyRoot, 'functions');
const outDir = path.join(netlifyRoot, 'dist', 'functions');

const EXTERNAL = ['subset-font', 'harfbuzzjs', 'firebase-admin', 'firebase-admin/*'];

// This banner makes `require`, `__filename` and `__dirname` available inside
// the emitted ESM bundle, since Node's ESM loader does not provide them but
// some CJS dependencies pulled into the bundle expect them to exist.
//
// It assigns onto `globalThis` conditionally, rather than declaring local
// `const`/`let` bindings, because Netlify's own zip-it-and-ship-it packaging
// splices an equivalent `__filename`/`__dirname`/`require` shim (using their
// own `let` declarations) directly ahead of this file's contents for every
// deployed .mjs function, regardless of node_bundler. A local declaration of
// the same names here would collide with theirs and throw
// `SyntaxError: Identifier '__filename' has already been declared`. Bare
// references to `require`/`__filename`/`__dirname` elsewhere in the bundle
// still resolve correctly either way: to Netlify's local `let` bindings when
// wrapped, or (when this file runs standalone, e.g. in local verification)
// via the global object, since unqualified identifiers fall through the
// scope chain to properties set on `globalThis`.
const banner = `import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import __path from 'node:path';
if (typeof globalThis.require === 'undefined') {
  globalThis.require = __createRequire(import.meta.url);
}
if (typeof globalThis.__filename === 'undefined') {
  globalThis.__filename = __fileURLToPath(import.meta.url);
}
if (typeof globalThis.__dirname === 'undefined') {
  globalThis.__dirname = __path.dirname(globalThis.__filename);
}
`;

async function main() {
  const entries = fs
    .readdirSync(functionsDir)
    .filter((f) => f.endsWith('.mts'))
    .map((f) => path.join(functionsDir, f));

  if (entries.length === 0) {
    throw new Error(`No .mts entry files found in ${functionsDir}`);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    const base = path.basename(entry, '.mts');
    const outfile = path.join(outDir, `${base}.mjs`);

    try {
      await esbuild.build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        external: EXTERNAL,
        banner: { js: banner },
        minify: false,
        sourcemap: false,
        logLevel: 'warning',
      });
    } catch (err) {
      console.error(`[build-functions] esbuild failed for ${base}:`, err);
      process.exit(1);
    }

    console.log(`[build-functions] built ${base}.mjs`);
  }

  console.log(`[build-functions] ${entries.length} function(s) bundled into ${path.relative(netlifyRoot, outDir)}`);
}

main().catch((err) => {
  console.error('[build-functions] fatal error:', err);
  process.exit(1);
});
