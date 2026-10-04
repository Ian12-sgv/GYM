// Arma la DEMO estática para publicar en Netlify (carpeta dist/).
// Todo corre en el navegador: la API la atiende un service worker con sql.js.
// Uso: npm run build:demo        (y con --serve la sirve en http://localhost:4173 para probarla)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const out = path.join(root, 'dist');
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });

// Fuentes: solo los pesos que usa la app y los archivos que esos CSS piden.
const fonts = { '@fontsource/barlow-condensed': ['700'], '@fontsource/ibm-plex-sans': ['400', '500', '600'] };
for (const [pkg, weights] of Object.entries(fonts)) {
  const dir = pkgDir(pkg);
  const dest = path.join(out, 'vendor/fonts', pkg.split('/')[1]);
  for (const w of weights) {
    const css = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
    copy(path.join(dir, `${w}.css`), path.join(dest, `${w}.css`));
    for (const [, file] of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) copy(path.join(dir, 'files', file), path.join(dest, 'files', file));
  }
}

copy(path.join(pkgDir('html5-qrcode'), 'html5-qrcode.min.js'), path.join(out, 'vendor/html5-qrcode.min.js'));
copy(require.resolve('sql.js/dist/sql-wasm-browser.wasm'), path.join(out, 'sql-wasm.wasm'));

await build({
  entryPoints: [path.join(root, 'src/demo/sw.js')],
  outfile: path.join(out, 'demo-sw.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
});

// Marca la página como demo antes de que arranque la app.
const indexFile = path.join(out, 'index.html');
const appTag = '<script type="module" src="/js/app.js"></script>';
const index = fs.readFileSync(indexFile, 'utf8');
if (!index.includes(appTag)) throw new Error('No se encontró el script de la app en index.html');
fs.writeFileSync(indexFile, index.replace(appTag, `<script>window.GYM_DEMO = true;</script>\n  ${appTag}`));

const size = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`Demo lista en dist/ (${(size(out) / 1024 / 1024).toFixed(1)} MB)`);

if (process.argv.includes('--serve')) {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.static(out));
  app.listen(4173, () => console.log('Probando la demo en http://localhost:4173'));
}
