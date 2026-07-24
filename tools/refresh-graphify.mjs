import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'src');
const outputRoot = path.join(repoRoot, 'graphify-out');
const nestedOutput = path.join(sourceRoot, 'graphify-out');
const graphPath = path.join(outputRoot, 'graph.json');
const lockPath = path.join(outputRoot, '.graphify-refresh.lock');
const GENERATED_ARTIFACTS = [
  '.graphify_analysis.json',
  '.graphify_labels.json',
  '.graphify_labels.json.sig',
  'graph.html',
  'graph.json',
  'GRAPH_REPORT.md',
  'manifest.json',
];
const ROOT_MARKER = '.graphify_root';

const HELP = `Usage: npm run graphify:refresh -- [--force]

Builds and validates a fresh src-only project graph in a temporary directory,
then promotes only the accepted generated artifacts into the repository-level
graphify-out directory. --force explicitly permits a lower node count after an
intentional large source deletion or refactor.`;

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function comparablePath(filePath) {
  const normalized = path.resolve(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function parseArguments(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return { help: true, force: false };
  }

  const unknown = argv.filter((argument) => argument !== '--force');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}\n\n${HELP}`);
  }

  return { help: false, force: argv.includes('--force') };
}

async function runGraphify(argumentsList) {
  const executable = process.platform === 'win32' ? 'graphify.exe' : 'graphify';
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd: repoRoot,
      env: { ...process.env },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });

    child.once('error', reject);
    child.once('exit', (exitCode, signal) => {
      if (signal) {
        reject(new Error(`Graphify was terminated by ${signal}.`));
        return;
      }
      resolve(exitCode ?? 1);
    });
  });

  if (code !== 0) {
    throw new Error(`Graphify ${argumentsList[0]} failed with exit code ${code}.`);
  }
}

function graphCounts(graph) {
  return {
    nodes: Array.isArray(graph?.nodes) ? graph.nodes.length : 0,
    links: Array.isArray(graph?.links) ? graph.links.length : 0,
  };
}

function validateGraph(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph?.links) ? graph.links : [];
  if (nodes.length === 0 || links.length === 0) {
    throw new Error('Graphify produced an empty or malformed graph.');
  }

  const nodeIds = new Set(nodes.map((node) => node?.id).filter(Boolean));
  const exactEdges = new Set();
  let missingEndpoints = 0;
  let selfLoops = 0;
  let duplicateEdges = 0;
  let escapedSources = 0;

  for (const node of nodes) {
    const sourceFile = String(node?.source_file ?? '').replaceAll('\\', '/');
    if (sourceFile.startsWith('../') || path.isAbsolute(sourceFile)) escapedSources += 1;
  }

  for (const link of links) {
    if (!nodeIds.has(link?.source) || !nodeIds.has(link?.target)) missingEndpoints += 1;
    if (link?.source === link?.target) selfLoops += 1;
    const edgeKey = JSON.stringify([
      link?.source,
      link?.target,
      link?.relation,
      link?.source_file,
      link?.source_location,
    ]);
    if (exactEdges.has(edgeKey)) duplicateEdges += 1;
    exactEdges.add(edgeKey);
  }

  if (missingEndpoints || selfLoops || duplicateEdges || escapedSources) {
    throw new Error(
      `Graph integrity failed: ${missingEndpoints} missing endpoint(s), `
      + `${selfLoops} self-loop(s), ${duplicateEdges} exact duplicate edge(s), `
      + `${escapedSources} escaped source path(s).`,
    );
  }

  return { nodes: nodes.length, links: links.length };
}

async function normalizeGeneratedReport(reportPath) {
  const report = await readFile(reportPath, 'utf8');
  const heading = /^# Graph Report - .*?  \((\d{4}-\d{2}-\d{2})\)$/m;
  const genericInstruction = /- Run `graphify update(?: \.)?` after code changes \(no API cost\)\./;
  if (!heading.test(report) || !genericInstruction.test(report)) {
    throw new Error('Graphify report no longer matches the expected generated format.');
  }

  const safeInstruction = '- Run `npm run graphify:refresh` after code changes; the wrapper stages and validates a `src`-only graph before replacing root artifacts (no API cost).';
  const normalized = report
    .replace(heading, `# Graph Report - ${sourceRoot}  ($1)`)
    .replace(genericInstruction, safeInstruction);
  await writeFile(reportPath, normalized, 'utf8');
}

async function copyArtifacts(fromDirectory, toDirectory, names) {
  await mkdir(toDirectory, { recursive: true });
  for (const name of names) {
    await copyFile(path.join(fromDirectory, name), path.join(toDirectory, name));
  }
}

async function promoteArtifacts(stageOutput, backupDirectory) {
  const names = [...GENERATED_ARTIFACTS, ROOT_MARKER];
  const previouslyPresent = new Set();
  await mkdir(backupDirectory, { recursive: true });

  for (const name of names) {
    const currentPath = path.join(outputRoot, name);
    if (await exists(currentPath)) {
      previouslyPresent.add(name);
      await copyFile(currentPath, path.join(backupDirectory, name));
    }
  }

  try {
    await copyArtifacts(stageOutput, outputRoot, names);
  } catch (error) {
    for (const name of names) {
      const destination = path.join(outputRoot, name);
      if (previouslyPresent.has(name)) {
        await copyFile(path.join(backupDirectory, name), destination);
      } else if (await exists(destination)) {
        await unlink(destination);
      }
    }
    throw error;
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`Another Graphify refresh owns ${lockPath}.`);
    }
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return;

  if (!(await exists(sourceRoot))) throw new Error(`Source directory is missing: ${sourceRoot}`);
  if (!(await exists(graphPath))) {
    throw new Error(`Existing graph is missing: ${graphPath}. Run a full Graphify extraction first.`);
  }
  if (await exists(nestedOutput)) {
    throw new Error(`Refusing to refresh while a nested output exists: ${nestedOutput}`);
  }

  const lockHandle = await acquireLock();
  const stageRoot = await mkdtemp(path.join(os.tmpdir(), 'minimalist-chat-graphify-'));
  let succeeded = false;

  try {
    const existingGraph = JSON.parse(await readFile(graphPath, 'utf8'));
    const existing = graphCounts(existingGraph);
    const stageOutput = path.join(stageRoot, 'graphify-out');

    await runGraphify(['extract', sourceRoot, '--out', stageRoot, '--code-only']);
    await runGraphify(['cluster-only', stageRoot]);

    for (const name of GENERATED_ARTIFACTS) {
      if (!(await exists(path.join(stageOutput, name)))) {
        throw new Error(`Staged Graphify artifact is missing: ${name}`);
      }
    }

    await writeFile(path.join(stageOutput, ROOT_MARKER), sourceRoot, 'utf8');
    await normalizeGeneratedReport(path.join(stageOutput, 'GRAPH_REPORT.md'));

    const stagedGraph = JSON.parse(await readFile(path.join(stageOutput, 'graph.json'), 'utf8'));
    const staged = validateGraph(stagedGraph);
    if (!options.force && existing.nodes > 0 && staged.nodes < existing.nodes) {
      throw new Error(
        `Shrink guard refused ${existing.nodes} -> ${staged.nodes} nodes. `
        + 'Re-run with --force only after verifying an intentional source deletion or refactor.',
      );
    }

    await promoteArtifacts(stageOutput, path.join(stageRoot, 'accepted-backup'));

    const installedMarker = (await readFile(path.join(outputRoot, ROOT_MARKER), 'utf8')).trim();
    const installedGraph = JSON.parse(await readFile(graphPath, 'utf8'));
    const installed = validateGraph(installedGraph);
    if (!samePath(installedMarker, sourceRoot)) {
      throw new Error(`Installed root marker does not resolve to ${sourceRoot}.`);
    }
    if (await exists(nestedOutput)) {
      throw new Error(`Graphify wrote an unexpected nested output: ${nestedOutput}`);
    }

    succeeded = true;
    console.log(
      `Graphify refresh complete: ${installed.nodes} nodes, ${installed.links} edges; `
      + 'staged integrity, src-only scope, and root output verified.',
    );
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch(() => {});
    if (succeeded) {
      const stagePrefix = comparablePath(path.join(os.tmpdir(), 'minimalist-chat-graphify-'));
      if (!comparablePath(stageRoot).startsWith(stagePrefix)) {
        throw new Error(`Refusing to clean unexpected staging path: ${stageRoot}`);
      }
      await rm(stageRoot, { recursive: true, force: false });
    } else {
      console.error(`[graphify:refresh] Rejected staging retained for inspection: ${stageRoot}`);
    }
  }
}

main().catch((error) => {
  console.error(`[graphify:refresh] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
