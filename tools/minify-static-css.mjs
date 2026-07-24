import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { transform } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
const browserTargets = ['chrome111', 'edge111', 'firefox121', 'safari16.4'];

function collectCss(path, files = []) {
  if (!existsSync(path)) return files;
  const stats = statSync(path);
  if (stats.isDirectory()) {
    readdirSync(path).forEach((entry) => collectCss(join(path, entry), files));
  } else if (path.endsWith('.css')) {
    files.push(path);
  }
  return files;
}

let sourceBytes = 0;
let outputBytes = 0;
let processedFiles = 0;

for (const sourcePath of collectCss(publicDir)) {
  const relativePath = relative(publicDir, sourcePath);
  const outputPath = join(distDir, relativePath);
  if (!existsSync(outputPath)) continue;

  const source = readFileSync(outputPath, 'utf8');
  const result = await transform(source, {
    loader: 'css',
    legalComments: 'inline',
    minify: true,
    sourcefile: relativePath,
    target: browserTargets,
  });

  writeFileSync(outputPath, result.code, 'utf8');
  sourceBytes += Buffer.byteLength(source);
  outputBytes += Buffer.byteLength(result.code);
  processedFiles += 1;
}

const savedKib = (sourceBytes - outputBytes) / 1024;
process.stdout.write(`Minified ${processedFiles} copied stylesheets; saved ${savedKib.toFixed(1)} KiB raw.\n`);
