import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatStockQuoteReply,
  isStockQuoteRequest,
  resolveStockQuoteRequest,
} from '../src/features/ai/stockQuoteTool.js';

test('recognizes explicit stock quote requests without intercepting normal AI questions', () => {
  assert.equal(isStockQuoteRequest('What is AAPL trading at?'), true);
  assert.equal(isStockQuoteRequest('Can you get the current Apple stock price?'), true);
  assert.equal(isStockQuoteRequest('/stock TSLA'), true);
  assert.equal(isStockQuoteRequest('Summarize the latest room decisions'), false);
  assert.equal(isStockQuoteRequest('What is the price of lunch?'), false);
});

test('resolves command, company, uppercase, and lowercase ticker forms', () => {
  const resolve = (content) => resolveStockQuoteRequest({ messages: [{ role: 'user', content }] });

  assert.deepEqual(resolve('/stock TSLA'), { symbol: 'TSLA', inferredFromRoom: false });
  assert.deepEqual(resolve('What is Apple stock worth now?'), { symbol: 'AAPL', inferredFromRoom: false });
  assert.deepEqual(resolve('What is AAPL trading at?'), { symbol: 'AAPL', inferredFromRoom: false });
  assert.deepEqual(resolve('Give me the aapl stock price'), { symbol: 'AAPL', inferredFromRoom: false });
});

test('a vague request infers the latest successful Stock Price Bot ticker', () => {
  const context = {
    messages: [
      { name: 'Stock Price Bot', text: 'AAPL · Apple Inc.\n▲ USD 211.18 (+1.25, +0.59%)' },
      { name: 'Stock Price Bot', text: "I couldn't fetch APPL: Stooq quote failed (404)" },
    ],
  };

  assert.deepEqual(
    resolveStockQuoteRequest({
      context,
      messages: [{ role: 'user', content: 'Can you get a realtime stock price?' }],
    }),
    { symbol: 'AAPL', inferredFromRoom: true },
  );
});

test('a vague stock request with no trusted ticker asks for one instead of guessing', () => {
  assert.deepEqual(
    resolveStockQuoteRequest({ messages: [{ role: 'user', content: 'Can you get a live stock price?' }] }),
    { symbol: '', inferredFromRoom: false },
  );
});

test('formats sourced, timestamped market data without passing through unsafe provider text', () => {
  const reply = formatStockQuoteReply({
    symbol: 'AAPL',
    name: 'Apple Inc. [bad](javascript:alert(1)) https://evil.example',
    price: 211.18,
    currency: 'usd',
    change: 1.25,
    changePercent: 0.595,
    provider: 'Yahoo Finance',
    at: Date.UTC(2026, 6, 21, 20, 30),
  }, { inferredFromRoom: true });

  assert.match(reply, /## AAPL · Apple Inc\./);
  assert.match(reply, /\*\*USD 211\.18\*\*/);
  assert.match(reply, /\+1\.25 \(\+0\.59%\)/);
  assert.match(reply, /As of:/);
  assert.match(reply, /Source:\*\* Yahoo Finance/);
  assert.match(reply, /latest successful stock quote in this room/);
  assert.match(reply, /https:\/\/finance\.yahoo\.com\/quote\/AAPL\//);
  assert.doesNotMatch(reply, /javascript:|evil\.example/i);
});

test('Room AI and Winston run the market tool before waking the language model', async () => {
  const aiSource = await readFile(new URL('../src/features/ai/AI.jsx', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../src/features/ai/localAiClient.js', import.meta.url), 'utf8');

  assert.equal((aiSource.match(/await tryAgentLiveTool\(/g) || []).length, 2);
  assert.match(aiSource, /'market-data': 'Market data'/);
  assert.match(aiSource, /tryAgentLiveTool[\s\S]*?if \(liveToolResult\)[\s\S]*?refreshStatus\(\)/);
  assert.match(clientSource, /window\.STOCK_QUOTE_ENDPOINT \|\| DEFAULT_STOCK_QUOTE_ENDPOINT/);
  assert.match(clientSource, /fetchAuthedJson\(quoteEndpoint, \{ symbol: request\.symbol \}/);
});
