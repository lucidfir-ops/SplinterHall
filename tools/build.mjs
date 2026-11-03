// Build: bundle the game with esbuild into dist/web/, then write the itch.io and source zips.
//   node tools/build.mjs            build + zips
//   node tools/build.mjs --watch    rebuild on change (no zips)
//   node tools/build.mjs --nozip    build only
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'dist', 'web');
const watch = process.argv.includes('--watch');
const nozip = process.argv.includes('--nozip') || watch;

fs.mkdirSync(out, { recursive: true });

const opts = {
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome90', 'safari15', 'firefox90'],
  outfile: path.join(out, 'game.js'),
  minify: !watch && !process.env.NOMIN,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (!/\.(md|txt)$/i.test(e.name) || /LICEN|OFL|CREDITS/i.test(e.name)) fs.copyFileSync(s, d);
  }
}

function statics() {
  fs.copyFileSync(path.join(root, 'src', 'index.html'), path.join(out, 'index.html'));
  copyDir(path.join(root, 'assets'), path.join(out, 'assets'));
  if (fs.existsSync(path.join(root, 'CREDITS.md'))) fs.copyFileSync(path.join(root, 'CREDITS.md'), path.join(out, 'CREDITS.md'));
  // The bundle strips licence comments, so the bundled libraries' licences ship beside it.
  const libs = ['three', '@dimforge/rapier2d-compat', 'postprocessing', 'trystero', '@trystero-p2p/core', 'fflate', 'jsqr'];
  let text = 'Licences of the libraries bundled into game.js\n';
  for (const lib of libs) {
    const dir = path.join(root, 'node_modules', lib);
    const file = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    if (!file) continue;
    const ver = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    text += `\n\n==== ${lib} ${ver} ====\n\n` + fs.readFileSync(path.join(dir, file), 'utf8').trim() + '\n';
  }
  fs.writeFileSync(path.join(out, 'THIRD-PARTY-LICENSES.txt'), text);
}

// The source zip. In a git checkout it holds what git would commit (tracked and new files, minus .gitignore and
// .git/info/exclude), so local folders such as feedback/ and exports/ stay out; elsewhere, the folder minus build output.
function sourceZip(file) {
  if (fs.existsSync(path.join(root, '.git'))) {
    const files = execSync('git ls-files -z --cached --others --exclude-standard', { cwd: root, encoding: 'utf8' })
      .split('\0').filter((f) => f && fs.existsSync(path.join(root, f)));
    execSync(`zip -q -9 -@ "${file}"`, { cwd: root, input: files.join('\n') });
  } else {
    execSync(`cd "${root}" && zip -qr -9 "${file}" . -x "node_modules/*" "dist/*" ".git/*" "*.DS_Store" "tools/**/out/*" "feedback/*" "exports/*" "backups/*" "CLAUDE.md" "how to talk to claude.txt"`);
  }
}

if (watch) {
  const ctx = await esbuild.context(opts);
  statics();
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(opts);
  statics();
  if (!nozip) {
    const dist = path.join(root, 'dist');
    for (const f of ['splinterhall-itch.zip', 'splinterhall-source.zip', 'splinterhall-wifi-host.zip']) fs.rmSync(path.join(dist, f), { force: true });
    execSync(`cd "${out}" && zip -qr -9 ../splinterhall-itch.zip .`);
    sourceZip(path.join(dist, 'splinterhall-source.zip'));
    // The Wi-Fi host pack: the game plus a small Python server that also relays the room (optional itch download).
    const pack = path.join(dist, 'wifi-host');
    fs.rmSync(pack, { recursive: true, force: true });
    fs.cpSync(out, pack, { recursive: true });
    fs.cpSync(path.join(root, 'tools', 'release', 'wifi-host'), pack, { recursive: true });
    execSync(`cd "${pack}" && zip -qr -9 ../splinterhall-wifi-host.zip .`);
    const size = (f) => (fs.statSync(path.join(dist, f)).size / 1048576).toFixed(2) + ' MB';
    console.log('itch zip', size('splinterhall-itch.zip'), '· source zip', size('splinterhall-source.zip'), '· wifi host zip', size('splinterhall-wifi-host.zip'));
  }
}
