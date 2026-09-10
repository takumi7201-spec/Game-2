import fs from 'node:fs';

const R = p => fs.readFileSync(p, 'utf8');

// --- three core: turn the single trailing `export {...};` into a THREE namespace
let core = R('vendor/three.module.js');
const m = core.match(/^export \{([\s\S]*?)\};\s*$/m);
if (!m) throw new Error('three export block not found');
const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
core = core.replace(m[0], `const THREE = { ${names.join(', ')} };`);

// --- addons: drop every import (all names share one bundle scope) and `export`
const stripModule = (src) => src
  .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
  .replace(/^export\s+(?=(class|function|const|let|var|async))/gm, '')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

const addons = [
  'vendor/jsm/postprocessing/Pass.js',
  'vendor/jsm/shaders/CopyShader.js',
  'vendor/jsm/shaders/LuminosityHighPassShader.js',
  'vendor/jsm/shaders/OutputShader.js',
  'vendor/jsm/postprocessing/MaskPass.js',
  'vendor/jsm/postprocessing/ShaderPass.js',
  'vendor/jsm/postprocessing/RenderPass.js',
  'vendor/jsm/postprocessing/UnrealBloomPass.js',
  'vendor/jsm/postprocessing/OutputPass.js',
  'vendor/jsm/postprocessing/EffectComposer.js',
].map(p => `// ==== ${p} ====\n` + stripModule(R(p))).join('\n');

// addons keep private helpers named like three's internals (_camera, _geometry),
// so they get their own scope and only export what the demo uses
const addonsScoped = `const { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = (() => {
${addons}
return { EffectComposer, RenderPass, UnrealBloomPass, OutputPass };
})();`;

const mine = ['src/voxel.js', 'src/ground.js', 'src/world.js', 'src/chars.js', 'src/fx.js', 'src/main.js']
  .map(p => `// ==== ${p} ====\n` + stripModule(R(p))).join('\n');

const js = [core, addonsScoped, `(() => {\n${mine}\n})();`].join('\n');

// --- page shell: artifact format (no doctype/html/head/body of our own)
const page = R('index.html');
const head = page.slice(page.indexOf('<title>'), page.indexOf('</style>') + 8);
const bodyStart = page.indexOf('<canvas id="c">');
const bodyEnd = page.indexOf('<script type="importmap">');
const body = page.slice(bodyStart, bodyEnd);

fs.writeFileSync(process.argv[2], `${head}\n${body}<script type="module">\n${js}\n</script>\n`);
console.log('bytes', fs.statSync(process.argv[2]).size, '| three exports', names.length);
