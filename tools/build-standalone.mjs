// Bundle the demo into one self-contained HTML file.
//
//   npm i -D esbuild
//   node tools/build-standalone.mjs
//
// Writes dist/fossil-isle.html (a complete page you can open or host anywhere)
// and dist/fossil-isle.fragment.html (the same page without the <html>/<head>/
// <body> wrapper, for hosts that supply their own).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'dist');
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'none',
  target: ['es2020'],
  write: false,
});
const js = result.outputFiles[0].text;

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/\s*<script type="module"[^>]*><\/script>/, '')
  .trim();

// gallery hosts show the title on a card, where the subtitle is separate
const shortTitle = title.split('\u2014')[0].trim();

const fragment = [
  `<title>${shortTitle}</title>`,
  style,
  body,
  '<script type="module">',
  js,
  '</script>',
].join('\n');

const standalone = [
  '<!DOCTYPE html>',
  '<html lang="ja">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
  `<title>${title}</title>`,
  style,
  '</head>',
  '<body>',
  body,
  '<script type="module">',
  js,
  '</script>',
  '</body>',
  '</html>',
].join('\n');

writeFileSync(resolve(outDir, 'fossil-isle.html'), standalone);
writeFileSync(resolve(outDir, 'fossil-isle.fragment.html'), fragment);
console.log(`dist/fossil-isle.html           ${(standalone.length / 1e6).toFixed(2)} MB`);
console.log(`dist/fossil-isle.fragment.html  ${(fragment.length / 1e6).toFixed(2)} MB`);
