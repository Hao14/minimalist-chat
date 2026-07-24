#!/usr/bin/env node

import readline from 'node:readline';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function resultCandidates(args) {
  const sourceId = args.source_id || 'default';
  if (String(args.query).includes('conflict')) {
    return [
      {
        source_id: sourceId,
        slug: 'current-plan',
        title: 'Current Plan',
        score: 0.9,
        evidence: 'exact_title_match',
        chunk_text: 'The launch date is 2026-08-01.',
      },
      {
        source_id: sourceId,
        slug: 'alternate-plan',
        title: 'Alternate Plan',
        score: 0.88,
        evidence: 'exact_title_match',
        chunk_text: 'The launch date is 2026-09-15.',
      },
    ];
  }
  if (String(args.query).includes('weak')) {
    return [{
      source_id: sourceId,
      slug: 'unrelated',
      title: 'Cooking Notes',
      score: 0.01,
      evidence: 'weak_semantic',
      chunk_text: 'A bread recipe uses flour and water.',
    }];
  }
  return [
    {
      source_id: sourceId,
      slug: 'legacy-plan',
      title: 'Legacy Plan',
      score: 0.91,
      evidence: 'keyword_exact',
      chunk_text: 'The old project plan is archived.',
    },
    {
      source_id: sourceId,
      slug: 'current-plan',
      title: 'Current Project Plan',
      score: 0.86,
      evidence: 'exact_title_match',
      chunk_text: 'The current project plan is active.',
    },
    {
      source_id: sourceId,
      slug: 'current-plan',
      title: 'Current Project Plan',
      score: 0.85,
      evidence: 'keyword_exact',
      chunk_text: 'A second chunk from the same current project plan.',
    },
  ];
}

const reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${line}\n`);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-gbrain', version: '0.0.0' },
      },
    });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          { name: 'query', description: 'fake query', inputSchema: { type: 'object' } },
          { name: 'ping', description: 'fake passthrough', inputSchema: { type: 'object' } },
        ],
      },
    });
    return;
  }
  if (message.method === 'tools/call' && message.params?.name === 'ping') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text: JSON.stringify({ untouched: true, args: message.params.arguments }) }] },
    });
    return;
  }
  if (message.method === 'tools/call' && ['query', 'search'].includes(message.params?.name)) {
    const args = message.params.arguments || {};
    const query = String(args.query);
    if (query.includes('mixed candidate blocks')) {
      const sourceId = args.source_id || 'default';
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify([{
                source_id: sourceId,
                slug: 'current-plan',
                title: 'Current Project Plan',
                score: 0.9,
                chunk_text: 'The current project plan is active.',
              }]),
            },
            {
              type: 'text',
              text: JSON.stringify([{
                source_id: sourceId,
                slug: 'legacy-plan',
                title: 'Legacy Plan',
                score: 0.8,
                aliases: 'invalid candidate metadata',
              }]),
            },
          ],
        },
      });
      return;
    }
    const text = query.includes('malformed') ? 'not-json-from-child' : JSON.stringify(resultCandidates(args));
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text }] } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } });
});
