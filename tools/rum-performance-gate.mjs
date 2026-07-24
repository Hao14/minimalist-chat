import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export const RUM_GATE_THRESHOLDS = Object.freeze({
  lcp: 2500,
  inp: 200,
  cls: 0.1,
});

export const RUM_REGRESSION_TOLERANCES = Object.freeze({
  lcp: Object.freeze({ absolute: 150, relative: 0.10 }),
  inp: Object.freeze({ absolute: 25, relative: 0.15 }),
  cls: Object.freeze({ absolute: 0.02, relative: 0.20 }),
});

function booleanEnvironment(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || '').trim());
}

function validateSummary(summary, label = 'RUM summary') {
  if (!summary || summary.format !== 'minimalist-rum-p75-v1') {
    throw new Error(`${label} must use the minimalist-rum-p75-v1 format.`);
  }
}

function summaryMinimumSamples(summary) {
  return Math.max(1, Math.floor(Number(summary.gate?.minimumSamples) || 75));
}

function metricResult(summary, deviceClass, metric) {
  const result = summary.devices?.[deviceClass]?.metrics?.[metric] || {};
  return {
    count: Math.max(0, Math.floor(Number(result.count) || 0)),
    p75: Number.isFinite(Number(result.p75)) ? Number(result.p75) : null,
  };
}

export function evaluateRumGate(summary, { baseline = null } = {}) {
  validateSummary(summary);
  if (baseline) validateSummary(baseline, 'RUM baseline summary');

  const minimumSamples = summaryMinimumSamples(summary);
  const checks = [];
  for (const deviceClass of ['mobile', 'desktop']) {
    for (const [metric, threshold] of Object.entries(RUM_GATE_THRESHOLDS)) {
      const { count, p75 } = metricResult(summary, deviceClass, metric);
      const status = count < minimumSamples || p75 === null
        ? 'insufficient'
        : p75 <= threshold ? 'pass' : 'fail';
      checks.push({
        kind: 'threshold',
        deviceClass,
        metric,
        count,
        minimumSamples,
        p75,
        threshold,
        status,
      });
    }
  }

  if (baseline) {
    const baselineMinimumSamples = summaryMinimumSamples(baseline);
    for (const deviceClass of ['mobile', 'desktop']) {
      for (const [metric, tolerance] of Object.entries(RUM_REGRESSION_TOLERANCES)) {
        const current = metricResult(summary, deviceClass, metric);
        const previous = metricResult(baseline, deviceClass, metric);
        const allowedIncrease = previous.p75 === null
          ? null
          : Math.max(tolerance.absolute, previous.p75 * tolerance.relative);
        const regressionLimit = allowedIncrease === null ? null : previous.p75 + allowedIncrease;
        const status = current.count < minimumSamples
          || previous.count < baselineMinimumSamples
          || current.p75 === null
          || previous.p75 === null
          ? 'insufficient'
          : current.p75 <= regressionLimit ? 'pass' : 'fail';
        checks.push({
          kind: 'regression',
          deviceClass,
          metric,
          count: current.count,
          minimumSamples,
          p75: current.p75,
          baselineCount: previous.count,
          baselineMinimumSamples,
          baselineP75: previous.p75,
          absoluteTolerance: tolerance.absolute,
          relativeTolerance: tolerance.relative,
          allowedIncrease,
          threshold: regressionLimit,
          status,
        });
      }
    }
  }

  return {
    passing: checks.every((check) => check.status !== 'fail'),
    ready: checks.every((check) => check.status !== 'insufficient'),
    eligibleChecks: checks.filter((check) => check.status !== 'insufficient').length,
    baselineCompared: Boolean(baseline),
    checks,
  };
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function readSummary(environment, {
  fileArgument,
  fileEnvironment,
  urlArgument,
  urlEnvironment,
} = {}) {
  const file = argumentValue(fileArgument) || environment[fileEnvironment];
  if (file) return JSON.parse(await readFile(file, 'utf8'));

  const url = argumentValue(urlArgument) || environment[urlEnvironment];
  if (!url) return null;
  const token = String(environment.PERFORMANCE_RUM_READ_TOKEN || '').trim();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`RUM summary request failed with HTTP ${response.status}.`);
  return response.json();
}

async function main() {
  const required = booleanEnvironment(process.env.REQUIRE_RUM_PERFORMANCE_GATE);
  const summary = await readSummary(process.env, {
    fileArgument: 'file',
    fileEnvironment: 'MINIMALIST_RUM_SUMMARY_FILE',
    urlArgument: 'url',
    urlEnvironment: 'MINIMALIST_RUM_SUMMARY_URL',
  });
  if (!summary) {
    if (required) throw new Error('RUM gate is required, but no summary file or URL was configured.');
    process.stdout.write('RUM performance gate skipped (no field summary configured).\n');
    return;
  }

  const expectedRelease = String(
    argumentValue('release') || process.env.MINIMALIST_RUM_RELEASE_ID || '',
  ).trim();
  if (expectedRelease && summary.release !== expectedRelease) {
    throw new Error(
      `RUM summary release ${summary.release || '(missing)'} does not match build ${expectedRelease}.`,
    );
  }

  const baseline = await readSummary(process.env, {
    fileArgument: 'baseline-file',
    fileEnvironment: 'MINIMALIST_RUM_BASELINE_SUMMARY_FILE',
    urlArgument: 'baseline-url',
    urlEnvironment: 'MINIMALIST_RUM_BASELINE_SUMMARY_URL',
  });
  if (required && !baseline) {
    throw new Error(
      'RUM gate is required, but no baseline summary file or URL was configured.',
    );
  }

  const result = evaluateRumGate(summary, { baseline });
  for (const check of result.checks) {
    const observed = check.p75 === null ? 'n/a' : check.p75;
    if (check.kind === 'regression') {
      process.stdout.write(
        `${check.deviceClass} p75 ${check.metric} regression: ${observed} ${check.status} `
        + `(baseline ${check.baselineP75 ?? 'n/a'}, limit ${check.threshold ?? 'n/a'}, `
        + `samples ${check.count}/${check.minimumSamples}, `
        + `baseline samples ${check.baselineCount}/${check.baselineMinimumSamples})\n`,
      );
    } else {
      process.stdout.write(
        `${check.deviceClass} p75 ${check.metric}: ${observed} ${check.status} `
        + `(limit ${check.threshold}, samples ${check.count}/${check.minimumSamples})\n`,
      );
    }
  }

  if (!result.passing) {
    process.exitCode = 1;
    return;
  }
  if (required && !result.ready) {
    throw new Error(
      'RUM gate is required, but mobile and desktop have not both reached the minimum sample size.',
    );
  }
}

const launchedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (launchedDirectly) {
  main().catch((error) => {
    process.stderr.write(`RUM performance gate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
