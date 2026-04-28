// Quick CLI smoke test for the chat engine.
// Runs the parser → analyzer → chatEngine pipeline against the synthetic
// workbook and prints the answer for a representative set of questions.
//
// Usage: node scripts/chat_smoke.mjs

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseWorkbookBuffer } from '../src/lib/parser.js';
import { runAllAnalysis } from '../src/lib/analyzer.js';
import { answerQuestion } from '../src/lib/chatEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const samplePath = path.resolve(__dirname, '../sample-data/synthetic_ga4.xlsx');

const buf = await readFile(samplePath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const { parsed, analysisSheets, rawTotals } = parseWorkbookBuffer(
  ab,
  'synthetic_ga4.xlsx',
);
const analyzed = runAllAnalysis(parsed, { rawTotals, analysisSheets });

const QUESTIONS = [
  'Hi',
  'What can you do?',
  'Give me a high-level summary',
  'How many sessions did we have?',
  'How many new users?',
  'What is my bounce rate?',
  'How does my bounce compare to industry?',
  'What are the top 5 traffic sources?',
  'How is google performing?',
  'Show me top pages',
  'Show me unicorn pages',
  'Which pages bleed visitors?',
  'How is /contact/ doing?',
  'What was my best month?',
  'Tell me about may',
  'Show me anomalies',
  'How many leads did we get?',
  'Are there any bots?',
  'Compare mobile vs desktop',
  'What is bounce rate?',
  'How can I improve my bounce rate?',
  'Why don\'t the numbers match my pivot table?',
  'What is the capital of France?', // should fall back to web
];

for (const q of QUESTIONS) {
  const r = answerQuestion(analyzed, q);
  console.log('━'.repeat(80));
  console.log('Q:', q);
  console.log('intent:', r.intent, '· source:', r.source);
  console.log('A:');
  console.log(r.answer);
  if (r.suggestions?.length) {
    console.log('suggestions:', r.suggestions.slice(0, 4).join(' | '));
  }
}
