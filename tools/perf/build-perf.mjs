// Bundle a copy of the game for performance tests, away from dist/web (so other builds can't change it mid-test).
//   node tools/perf/build-perf.mjs <outDir> [--src <dir with main.js>] [--minify]
// The bundle is unminified by default so CPU profiles keep function names. Assets are symlinked.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const args = process.argv.slice(2);
const out = path.resolve(args[0] || path.join(root, 'tools', 'perf', 'out', 'web'));
const si = args.indexOf('--src');
const src = path.resolve(si >= 0 ? args[si + 1] : path.join(root, 'src'));
const minify = args.includes('--minify');

fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(src, 'main.js')],
  bundle: true, format: 'esm', target: ['es2020'], outfile: path.join(out, 'game.js'),
  minify, keepNames: !minify, legalComments: 'none', logLevel: 'warning',
  nodePaths: [path.join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"production"' },
});
fs.copyFileSync(path.join(src, 'index.html'), path.join(out, 'index.html'));
const link = path.join(out, 'assets');
if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, 'assets'), link);
console.log('built', out, 'from', src);
