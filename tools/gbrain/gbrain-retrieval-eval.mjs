#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadCodeAuthorityCatalog,
  loadMarkdownAuthorityCatalog,
  mergeAuthorityCatalogs,
} from './gbrain-authority-ranker.mjs';
import { executeAuthorityQuery } from './gbrain-authority-query.mjs';
import {
  describeSourceProvenanceCatalogs,
  loadSourceProvenanceCatalogs,
  resolveResultSourceProvenance,
  SOURCE_PROVENANCE_METHOD,
} from './gbrain-source-provenance.mjs';

const DEFAULT_THRESHOLDS = {
  hit_at_3_rate: 0.8,
  mean_recall_at_k: 0.9,
  mean_reciprocal_rank: 0.7,
  expected_top1_hit_rate: 0.6,
};

export function parseArgs(argv) {
  const options = {
    qrels: null,
    output: null,
    k: 10,
    gate: false,
    quiet: false,
    validateOnly: false,
    frozenProvenance: false,
    authorityRanking: true,
    queryIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--qrels') options.qrels = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--k') options.k = Number.parseInt(argv[++index], 10);
    else if (argument === '--query-id') options.queryIds.push(argv[++index]);
    else if (argument === '--gate') options.gate = true;
    else if (argument === '--quiet') options.quiet = true;
    else if (argument === '--validate-only') options.validateOnly = true;
    else if (argument === '--frozen-provenance') options.frozenProvenance = true;
    else if (argument === '--authority-ranking') options.authorityRanking = true;
    else if (argument === '--no-authority-ranking') options.authorityRanking = false;
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node tools/gbrain/gbrain-retrieval-eval.mjs --qrels <file> [--output <json>] [--k 10] [--gate] [--query-id <id>] [--authority-ranking|--no-authority-ranking] [--frozen-provenance] [--validate-only] [--quiet]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.qrels) throw new Error('--qrels is required.');
  if (!Number.isInteger(options.k) || options.k < 1 || options.k > 50) {
    throw new Error('--k must be an integer from 1 to 50.');
  }
  if (options.queryIds.some((queryId) => typeof queryId !== 'string' || !queryId.trim())) {
    throw new Error('--query-id requires a non-empty value.');
  }
  return options;
}

export function relevantRefs(entry) {
  if (Array.isArray(entry.relevant)) return entry.relevant;
  return (entry.relevant_slugs ?? []).map((slug) => ({ source_id: 'default', slug }));
}

export function expectedTop1Ref(entry) {
  if (entry.expected_top1) return entry.expected_top1;
  if (entry.first_relevant_slug) return { source_id: 'default', slug: entry.first_relevant_slug };
  return null;
}

function referenceKey(reference) {
  return `${reference.source_id}::${reference.slug}`;
}

function assertReference(reference, label, queryId, { grade = false } = {}) {
  if (
    !reference
    || typeof reference.source_id !== 'string'
    || !reference.source_id.trim()
    || typeof reference.slug !== 'string'
    || !reference.slug.trim()
  ) {
    throw new Error(`${queryId}: ${label} entries require non-empty source_id and slug fields.`);
  }
  if (grade && reference.grade !== undefined && (
    !Number.isInteger(reference.grade) || reference.grade < 1 || reference.grade > 3
  )) {
    throw new Error(`${queryId}: relevance grades must be integers from 1 to 3.`);
  }
}

export function validateQrels(qrels) {
  if (![1, 2].includes(qrels.schema_version) || !Array.isArray(qrels.queries)) {
    throw new Error('Unsupported qrels file. Expected schema_version 1 or 2 with a queries array.');
  }
  if (qrels.queries.length === 0) throw new Error('The qrels file must contain at least one query.');

  const queryIds = new Set();
  const normalizedQueries = qrels.queries.map((entry) => {
    if (typeof entry.query_id !== 'string' || !entry.query_id.trim() || queryIds.has(entry.query_id)) {
      throw new Error('Each query_id must be a unique, non-empty string.');
    }
    queryIds.add(entry.query_id);
    if (typeof entry.query !== 'string' || !entry.query.trim()) {
      throw new Error(`${entry.query_id}: query must be a non-empty string.`);
    }
    if (entry.category !== undefined && (typeof entry.category !== 'string' || !entry.category.trim())) {
      throw new Error(`${entry.query_id}: category must be a non-empty string when provided.`);
    }

    const expectedTop1 = expectedTop1Ref(entry);
    const relevant = relevantRefs(entry).map((reference) => ({ ...reference }));
    const forbidden = (entry.forbidden ?? []).map((reference) => ({ ...reference }));
    relevant.forEach((reference) => assertReference(reference, 'relevant', entry.query_id, { grade: true }));
    forbidden.forEach((reference) => assertReference(reference, 'forbidden', entry.query_id));
    if (expectedTop1) assertReference(expectedTop1, 'expected_top1', entry.query_id);

    const relevantKeys = relevant.map(referenceKey);
    const forbiddenKeys = forbidden.map(referenceKey);
    if (new Set(relevantKeys).size !== relevantKeys.length) {
      throw new Error(`${entry.query_id}: relevant results must be unique.`);
    }
    if (new Set(forbiddenKeys).size !== forbiddenKeys.length) {
      throw new Error(`${entry.query_id}: forbidden results must be unique.`);
    }
    if (forbiddenKeys.some((key) => relevantKeys.includes(key))) {
      throw new Error(`${entry.query_id}: a result cannot be both relevant and forbidden.`);
    }

    const relevantSources = [...new Set(relevant.map((item) => item.source_id))];
    if (relevantSources.length > 1) {
      throw new Error(`${entry.query_id}: production evaluator requires relevant rows to share one source.`);
    }
    const sourceId = relevantSources[0] || entry.source_id;
    if (typeof sourceId !== 'string' || !sourceId.trim()) {
      throw new Error(`${entry.query_id}: source_id is required when no relevant rows are provided.`);
    }
    if (expectedTop1 && expectedTop1.source_id !== sourceId) {
      throw new Error(`${entry.query_id}: expected_top1 must use the query source.`);
    }
    if (expectedTop1 && !relevantKeys.includes(referenceKey(expectedTop1))) {
      throw new Error(`${entry.query_id}: expected_top1 must also appear in relevant.`);
    }

    const forbiddenSources = entry.forbidden_sources ?? [];
    if (!Array.isArray(forbiddenSources) || forbiddenSources.some((source) => typeof source !== 'string' || !source.trim())) {
      throw new Error(`${entry.query_id}: forbidden_sources must be an array of non-empty strings.`);
    }
    const hasNegativeCheck = forbidden.length > 0 || forbiddenSources.length > 0 || entry.check_source_scope === true;
    if (relevant.length === 0 && !hasNegativeCheck) {
      throw new Error(`${entry.query_id}: at least one relevant result or one negative check is required.`);
    }
    const forbiddenTopK = entry.forbidden_top_k ?? 3;
    if (!Number.isInteger(forbiddenTopK) || forbiddenTopK < 1 || forbiddenTopK > 50) {
      throw new Error(`${entry.query_id}: forbidden_top_k must be an integer from 1 to 50.`);
    }

    const gradedRelevant = relevant.map((reference) => ({
      ...reference,
      grade: reference.grade ?? (
        expectedTop1 && referenceKey(reference) === referenceKey(expectedTop1) ? 3 : 1
      ),
    }));
    return {
      ...entry,
      category: entry.category || 'uncategorized',
      source_id: sourceId,
      relevant: gradedRelevant,
      expected_top1: expectedTop1,
      forbidden,
      forbidden_sources: [...new Set(forbiddenSources)],
      forbidden_top_k: forbiddenTopK,
      has_negative_check: hasNegativeCheck,
      requires_verified_provenance: true,
    };
  });

  return { ...qrels, queries: normalizedQueries };
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function discountedCumulativeGain(grades) {
  return grades.reduce((sum, grade, index) => sum + ((2 ** grade) - 1) / Math.log2(index + 2), 0);
}

function deduplicateRankedResults(results) {
  const seen = new Set();
  const unique = [];
  for (const result of results) {
    const key = referenceKey(result);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(result);
  }
  return {
    results: unique,
    duplicateCount: results.length - unique.length,
  };
}

export function calculateCaseMetrics(entry, results, k) {
  // GBrain can return multiple chunks for one document slug. Retrieval metrics
  // are document-ranked metrics, so one identity may occupy only its first rank.
  // Deduplicating before every rank and negative window also prevents repeated
  // safe rows from pushing a forbidden document beyond its configured window.
  const deduplicated = deduplicateRankedResults(results);
  const uniqueResults = deduplicated.results;
  const rankedAtK = uniqueResults.slice(0, k);
  const relevantGradeByKey = new Map(entry.relevant.map((reference) => [referenceKey(reference), reference.grade]));
  const relevantKeys = new Set(relevantGradeByKey.keys());
  const rankedKeys = rankedAtK.map(referenceKey);
  const firstRelevantIndex = rankedKeys.findIndex((key) => relevantKeys.has(key));
  const relevantRetrieved = new Set(rankedKeys.filter((key) => relevantKeys.has(key))).size;
  const ndcgGrades = uniqueResults.slice(0, 10).map((result) => relevantGradeByKey.get(referenceKey(result)) ?? 0);
  const idealGrades = [...relevantGradeByKey.values()].sort((left, right) => right - left).slice(0, 10);
  const idealDcg = discountedCumulativeGain(idealGrades);
  const expectedKey = entry.expected_top1 ? referenceKey(entry.expected_top1) : null;
  const negativeWindow = uniqueResults.slice(0, entry.forbidden_top_k);
  const forbiddenSources = new Set(entry.forbidden_sources);
  const provenanceRequired = entry.requires_verified_provenance === true
    || entry.check_source_scope === true
    || entry.forbidden_sources.length > 0;
  const sourceIdsForResult = (result) => {
    if (result.source_provenance?.method === SOURCE_PROVENANCE_METHOD) {
      return Array.isArray(result.source_provenance.source_ids)
        ? result.source_provenance.source_ids
        : [];
    }
    return typeof result.source_id === 'string' && result.source_id ? [result.source_id] : [];
  };
  const hasVerifiedProvenance = (result) => (
    result.source_provenance?.method === SOURCE_PROVENANCE_METHOD
    && result.source_provenance.status === 'verified'
    && sourceIdsForResult(result).length === 1
    && result.source_id === sourceIdsForResult(result)[0]
  );
  const forbiddenHits = [];
  const forbiddenSourceHits = [];
  for (const result of negativeWindow) {
    const sourceIds = sourceIdsForResult(result);
    for (const reference of entry.forbidden) {
      if (reference.slug === result.slug && sourceIds.includes(reference.source_id)) {
        forbiddenHits.push({ source_id: reference.source_id, slug: reference.slug });
      }
    }
    for (const sourceId of sourceIds) {
      if (forbiddenSources.has(sourceId)) {
        forbiddenSourceHits.push({ source_id: sourceId, slug: result.slug });
      }
    }
  }
  const sourceScopePass = uniqueResults.every((result) => {
    const sourceIds = sourceIdsForResult(result);
    return sourceIds.length === 1
      && sourceIds[0] === entry.source_id
      && (!provenanceRequired || hasVerifiedProvenance(result));
  });
  const sourceScopeFailures = uniqueResults
    .filter((result) => {
      const sourceIds = sourceIdsForResult(result);
      return sourceIds.length !== 1
        || sourceIds[0] !== entry.source_id
        || (provenanceRequired && !hasVerifiedProvenance(result));
    })
    .map((result) => ({
      slug: result.slug,
      status: result.source_provenance?.status ?? 'unverified',
      source_ids: sourceIdsForResult(result),
    }));

  return {
    unique_result_count: uniqueResults.length,
    duplicate_result_count: deduplicated.duplicateCount,
    hit_at_3: entry.relevant.length ? firstRelevantIndex >= 0 && firstRelevantIndex < 3 : null,
    recall_at_k: entry.relevant.length ? round(relevantRetrieved / entry.relevant.length) : null,
    reciprocal_rank: entry.relevant.length && firstRelevantIndex >= 0
      ? round(1 / (firstRelevantIndex + 1))
      : entry.relevant.length ? 0 : null,
    ndcg_at_10: entry.relevant.length ? round(idealDcg ? discountedCumulativeGain(ndcgGrades) / idealDcg : 0) : null,
    first_relevant_rank: entry.relevant.length && firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
    expected_top1_hit: expectedKey ? referenceKey(uniqueResults[0] ?? {}) === expectedKey : null,
    source_scope_pass: sourceScopePass,
    source_scope_failures: sourceScopeFailures,
    forbidden_hits: forbiddenHits,
    forbidden_source_hits: forbiddenSourceHits,
    negative_check_pass: entry.has_negative_check
      ? sourceScopePass && forbiddenHits.length === 0 && forbiddenSourceHits.length === 0
      : null,
  };
}

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

export function summarizeCases(cases, k) {
  const retrievalCases = cases.filter((item) => item.metrics.recall_at_k !== null);
  const expectedCases = cases.filter((item) => item.metrics.expected_top1_hit !== null);
  const negativeCases = cases.filter((item) => item.metrics.negative_check_pass !== null);
  const safeRate = (items, predicate) => items.length ? round(items.filter(predicate).length / items.length) : null;
  const mean = (items, selector) => items.length
    ? round(items.reduce((sum, item) => sum + selector(item), 0) / items.length)
    : null;

  return {
    cases: cases.length,
    retrieval_cases: retrievalCases.length,
    negative_check_cases: negativeCases.length,
    duplicate_result_count: cases.reduce(
      (sum, item) => sum + Number(item.metrics.duplicate_result_count ?? 0),
      0,
    ),
    cases_with_duplicate_results: cases.filter(
      (item) => Number(item.metrics.duplicate_result_count ?? 0) > 0,
    ).length,
    hit_at_3_rate: safeRate(retrievalCases, (item) => item.metrics.hit_at_3),
    mean_recall_at_k: mean(retrievalCases, (item) => item.metrics.recall_at_k),
    mean_reciprocal_rank: mean(retrievalCases, (item) => item.metrics.reciprocal_rank),
    mean_ndcg_at_10: mean(retrievalCases, (item) => item.metrics.ndcg_at_10),
    first_relevant_at_1_rate: safeRate(retrievalCases, (item) => item.metrics.first_relevant_rank === 1),
    expected_top1_hit_rate: safeRate(expectedCases, (item) => item.metrics.expected_top1_hit),
    expected_top1_cases: expectedCases.length,
    source_scope_pass_rate: safeRate(cases, (item) => item.metrics.source_scope_pass),
    negative_check_pass_rate: safeRate(negativeCases, (item) => item.metrics.negative_check_pass),
    mean_retrieval_latency_ms: cases.length
      ? Math.round(cases.reduce((sum, item) => sum + item.latency_ms.retrieval, 0) / cases.length)
      : null,
    mean_ranking_latency_ms: cases.length
      ? Math.round(cases.reduce((sum, item) => sum + item.latency_ms.ranking, 0) / cases.length)
      : null,
    mean_latency_ms: cases.length
      ? Math.round(cases.reduce((sum, item) => sum + item.latency_ms.total, 0) / cases.length)
      : null,
    p95_latency_ms: percentile95(cases.map((item) => item.latency_ms.total)),
    k,
  };
}

function categorySummaries(cases, k) {
  const categories = new Map();
  for (const item of cases) {
    const bucket = categories.get(item.category) ?? [];
    bucket.push(item);
    categories.set(item.category, bucket);
  }
  return Object.fromEntries(
    [...categories.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, items]) => [category, summarizeCases(items, k)]),
  );
}

export function loadAuthorityCatalog(qrels, sourceProvenanceCatalogs) {
  const definitions = qrels.sources ?? {
    default: {
      kind: 'markdown',
      root: '../../Minimalist-chat-vault',
    },
  };
  const catalogs = [];
  for (const [sourceId, definition] of Object.entries(definitions)) {
    if (!definition || !['markdown', 'code'].includes(definition.kind) || !definition.root) {
      throw new Error(`Authority ranking does not support source ${sourceId}.`);
    }
    const provenanceCatalog = sourceProvenanceCatalogs.get(sourceId);
    if (provenanceCatalog?.status !== 'ready' || !provenanceCatalog.manifest_path) {
      throw new Error(`Authority ranking requires a ready trusted catalog for ${sourceId}.`);
    }
    const root = resolve(dirname(provenanceCatalog.manifest_path), '..');
    if (!existsSync(root)) throw new Error(`Authority source mirror is missing for ${sourceId}.`);
    const catalog = definition.kind === 'code'
      ? loadCodeAuthorityCatalog({ sourceId, manifestPath: provenanceCatalog.manifest_path })
      : loadMarkdownAuthorityCatalog({
        sourceId,
        root,
        include: definition.include,
        exclude: definition.exclude,
      });
    if (catalog.size === 0) throw new Error(`Authority catalog is empty for ${sourceId}.`);
    catalogs.push(catalog);
  }
  return mergeAuthorityCatalogs(...catalogs);
}

function gateFailures(summary, thresholds) {
  return Object.entries(thresholds)
    .filter(([metric, minimum]) => {
      if (typeof minimum !== 'number' || !Number.isFinite(minimum)) {
        throw new Error(`Gate threshold ${metric} must be a finite number.`);
      }
      return summary[metric] === null || summary[metric] === undefined || summary[metric] < minimum;
    })
    .map(([metric, minimum]) => ({ metric, actual: summary[metric] ?? null, minimum }));
}

export function runEvaluation(options) {
  const qrelsPath = resolve(options.qrels);
  const rawQrels = JSON.parse(readFileSync(qrelsPath, 'utf8'));
  const qrels = validateQrels(rawQrels);
  const selectedIds = new Set(options.queryIds ?? []);
  const entries = selectedIds.size
    ? qrels.queries.filter((entry) => selectedIds.has(entry.query_id))
    : qrels.queries;
  const missingIds = [...selectedIds].filter((queryId) => !entries.some((entry) => entry.query_id === queryId));
  if (missingIds.length) throw new Error(`Unknown query_id value(s): ${missingIds.join(', ')}`);

  if (options.validateOnly) {
    return {
      schema_version: 2,
      qrels_schema_version: qrels.schema_version,
      qrels_path: qrelsPath,
      validation: {
        passed: true,
        cases: entries.length,
        categories: [...new Set(entries.map((entry) => entry.category))].sort(),
        sources: [...new Set(entries.map((entry) => entry.source_id))].sort(),
        negative_check_cases: entries.filter((entry) => entry.has_negative_check).length,
      },
    };
  }

  const queryLimit = Math.max(options.k, 10);
  const sourceProvenanceCatalogs = loadSourceProvenanceCatalogs(qrels, qrelsPath, {
    sourcesRoot: options.provenanceSourcesRoot,
    verifyCurrentSources: options.frozenProvenance !== true,
  });
  const authorityCatalog = options.authorityRanking
    ? loadAuthorityCatalog(qrels, sourceProvenanceCatalogs)
    : new Map();
  const cases = [];
  for (const entry of entries) {
    const queryReport = executeAuthorityQuery({
      query: entry.query,
      sourceId: entry.source_id,
      limit: queryLimit,
      authorityRanking: options.authorityRanking,
      authorityRoot: null,
      authorityCatalog,
    });
    const verifiedResults = resolveResultSourceProvenance(queryReport.results, sourceProvenanceCatalogs, {
      requestedSourceId: entry.source_id,
    });
    const metrics = calculateCaseMetrics(entry, verifiedResults, options.k);
    cases.push({
      query_id: entry.query_id,
      category: entry.category,
      query: entry.query,
      source_id: entry.source_id,
      relevant: entry.relevant,
      expected_top1: entry.expected_top1,
      checks: {
        forbidden: entry.forbidden,
        forbidden_sources: entry.forbidden_sources,
        forbidden_top_k: entry.forbidden_top_k,
      },
      latency_ms: queryReport.latency_ms,
      metrics,
      results: verifiedResults,
    });
  }

  const summary = summarizeCases(cases, options.k);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(qrels.gate_thresholds ?? {}) };
  const failures = gateFailures(summary, thresholds);
  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    qrels_schema_version: qrels.schema_version,
    qrels_path: qrelsPath,
    k: options.k,
    query_limit: queryLimit,
    ranking: {
      mode: options.authorityRanking ? 'deterministic-authority-v1' : 'none',
      candidate_only: true,
    },
    source_provenance: {
      mode: SOURCE_PROVENANCE_METHOD,
      catalogs: describeSourceProvenanceCatalogs(sourceProvenanceCatalogs),
    },
    summary,
    per_category: categorySummaries(cases, options.k),
    gate: {
      requested: options.gate,
      passed: failures.length === 0,
      thresholds,
      failures,
    },
    cases,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = runEvaluation(options);
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) writeFileSync(resolve(options.output), rendered, 'utf8');
  if (!options.quiet) process.stdout.write(rendered);
  if (options.gate && report.gate && !report.gate.passed) process.exitCode = 1;
}

const isDirect = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirect) main();
