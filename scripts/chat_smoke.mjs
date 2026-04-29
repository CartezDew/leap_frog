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
  // Baseline / capabilities
  'Hi',
  'What can you do?',
  'Give me a high-level summary',

  // Category 1: KPI definitions and methodology
  'What is GA4?',
  'What is bounce rate and how is it calculated?',
  'What is the difference between sessions and users?',
  'What does engaged session mean in GA4?',
  'What does the .2 suffix on a user ID mean?',
  'What is a Google Signals ID (.17)?',

  // Category 2: data quality and bot traffic
  'How much of our traffic is bots?',
  'Why is Lanzhou, China showing up in our data?',
  'What is the JBCF Zfzcfefuvc source?',
  'Which cities should we filter out?',
  'What is the real bounce rate after removing bot traffic?',
  'How do we set up GA4 filters to remove bots?',

  // Category 3: assignment objectives
  'What is our current homepage bounce rate?',
  'How many total users did we have in 2025?',
  'How many users visited the cybersecurity page?',
  'How many contact form submissions did we get?',
  'What is the 50% conversion increase target?',
  'Can we hit the 20% bounce rate reduction?',
  'Which recommendation has the biggest impact?',

  // Category 4: channels and sources
  'Which traffic channel has the best engagement?',
  'Why does LinkedIn have a 70% bounce rate?',
  'How does organic compare to direct traffic?',
  'What is our email channel performance?',
  'How many sessions came from ChatGPT?',
  'What is Clutch.co and why does it have the best bounce rate?',
  'What percentage of traffic comes from mobile vs desktop?',

  // Category 5: pages and content
  'What are our top 10 pages by traffic?',
  'Which pages have the lowest bounce rates?',
  'Which pages should we add CTAs to?',
  'How does the CEO page perform compared to other leadership pages?',
  'Which blog posts have the highest bounce rates?',
  'How does the methodology page perform?',

  // Category 6: users and engagement
  'How many real human users visited the site?',
  'Who is user 30555264.17 and why do they matter?',
  'How many high-engagement users do we have?',
  'What does a typical buyer journey look like in our data?',
  'How many users visited for more than 3 months?',
  'What are the user personas and how are they assigned?',

  // Category 7: contacts and conversions
  'How many contact form submissions were genuine leads?',
  'How many were spam?',
  'What types of inquiries are we getting?',
  'Which months had the most contact form activity?',
  'What percentage of total sessions reach the contact page?',
  'What should we change about the contact form?',

  // Category 8: competitive and strategic
  'How does our bounce rate compare to B2B industry benchmarks?',
  'What trust signals are we missing above the fold?',
  'What is the manufacturing opportunity?',
  'What is the three-horizon expansion strategy?',
  'What should we prioritize first — SEO, LinkedIn, or email?',
  'How do I explain this dashboard to a client?',

  // Category 9: dashboard how-to
  'How do I upload a new data file?',
  'What file format does the dashboard accept?',
  'Why is a section grayed out?',
  'What does the validation report mean?',
  'How do I clear the data and start over?',
  'What date range does this data cover?',
  'Can I upload multiple files at once?',

  // Surprise prompt
  'Tell me something I don’t know',

  // Legacy representative questions
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
