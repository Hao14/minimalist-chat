import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceFont = join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'bold', 'Phosphor-Bold.ttf');
const sourceCss = join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'bold', 'style.css');
const outputWoff = join(root, 'public', 'phosphor-bold-subset.woff');
const outputWoff2 = join(root, 'public', 'phosphor-bold-subset.woff2');
const outputCss = join(root, 'public', 'phosphor-bold-subset.css');
const supportedExtensions = new Set(['.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const excludedFiles = new Set([outputCss, outputWoff, outputWoff2]);
const ignoredDynamicPrefixes = new Set([
  // RichTextEditor builds complete names such as ph-text-align-left at runtime.
  // The template prefix itself never reaches the DOM.
  'ph-text-align',
]);
const iconAliases = new Map([
  // These legacy class names are referenced by existing product surfaces but
  // do not exist in Phosphor 2.1.2's bold face. Keep them visible with the
  // closest supported bold glyph until the owning surfaces can be migrated.
  ['ph-bookmark-simple-fill', 'ph-bookmark-simple'],
  ['ph-timeline', 'ph-clock-counter-clockwise'],
]);

function collectFiles(path, files = []) {
  if (!existsSync(path)) return files;
  const stats = statSync(path);
  if (stats.isFile()) {
    if (supportedExtensions.has(extname(path)) && !excludedFiles.has(path)) files.push(path);
    return files;
  }
  readdirSync(path).forEach((entry) => collectFiles(join(path, entry), files));
  return files;
}

const files = [
  ...collectFiles(join(root, 'src')),
  ...collectFiles(join(root, 'public')),
  join(root, 'index.html'),
].filter((file) => existsSync(file) && !excludedFiles.has(file));

const requested = new Set();
files.forEach((file) => {
  const contents = readFileSync(file, 'utf8');
  contents.match(/\bph-[a-z0-9-]+\b/g)?.forEach((icon) => {
    if (!['ph-bold', 'ph-fill'].includes(icon) && !ignoredDynamicPrefixes.has(icon)) requested.add(icon);
  });
});

const fullCss = readFileSync(sourceCss, 'utf8');
const mappings = new Map();
const mappingPattern = /\.ph-bold\.(ph-[a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)";?\s*\}/gi;
for (const match of fullCss.matchAll(mappingPattern)) mappings.set(match[1], match[2].toLowerCase());

const resolvedMapping = (icon) => mappings.get(icon) || mappings.get(iconAliases.get(icon));
const supported = [...requested].filter((icon) => resolvedMapping(icon)).sort();
const missing = [...requested].filter((icon) => !resolvedMapping(icon)).sort();
const codepoints = [...new Set(supported.map((icon) => `U+${resolvedMapping(icon).toUpperCase()}`))];

for (const [outputFile, flavor] of [[outputWoff2, 'woff2'], [outputWoff, 'woff']]) {
  const subset = spawnSync('pyftsubset', [
    sourceFont,
    `--output-file=${outputFile}`,
    `--flavor=${flavor}`,
    `--unicodes=${codepoints.join(',')}`,
    '--layout-features=*',
    '--no-hinting',
  ], { cwd: root, encoding: 'utf8' });

  if (subset.status !== 0) {
    process.stderr.write(subset.stderr || subset.stdout || `pyftsubset failed for ${flavor}.`);
    process.exit(subset.status || 1);
  }
}

const css = `/* Generated from @phosphor-icons/web bold 2.1.2 for icons found in src/ and public/. */
/* Rebuild with: node tools/generate-phosphor-subset.mjs. Supported icons: ${supported.length}. */
${missing.length ? `/* Not present in @phosphor-icons/web/bold and intentionally left unmapped: ${missing.join(', ')}. */\n` : ''}@font-face {
  font-family: "Phosphor-Bold-Subset";
  src: url("/phosphor-bold-subset.woff2?v=4") format("woff2"),
       url("/phosphor-bold-subset.woff?v=4") format("woff");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

.ph-bold {
  font-family: "Phosphor-Bold-Subset" !important;
  speak: never;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  letter-spacing: 0;
  -webkit-font-feature-settings: "liga";
  -moz-font-feature-settings: "liga=1";
  -moz-font-feature-settings: "liga";
  -ms-font-feature-settings: "liga" 1;
  font-feature-settings: "liga";
  -webkit-font-variant-ligatures: discretionary-ligatures;
  font-variant-ligatures: discretionary-ligatures;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

${supported.map((icon) => `.ph-bold.${icon}:before { content: "\\${resolvedMapping(icon)}"; }`).join('\n')}
`;

writeFileSync(outputCss, css, 'utf8');
process.stdout.write(`Generated ${supported.length} Phosphor bold icons (${codepoints.length} glyphs).${missing.length ? ` Missing: ${missing.join(', ')}` : ''}\n`);
