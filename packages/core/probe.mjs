import { optimizeContext, optimizeContextSync } from './dist/index.js';

// A realistic-size TS file
const code = `
import { readFile, writeFile } from 'fs';
import { join } from 'path';

/** Represents a parsed data record */
export interface DataRecord {
  id: string;
  fields: Record<string, string>;
  source: string;
  createdAt: number;
}

function parseLine(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of line.split(',')) {
    const [k, v] = pair.split('=');
    if (k) out[k.trim()] = (v ?? '').trim();
  }
  return out;
}

function parseCsv(data: string): DataRecord[] {
  const lines = data.split('\n').filter(l => l.trim());
  return lines.map((line, i) => {
    const fields = parseLine(line);
    return {
      id: String(i),
      name: fields.name || 'unknown',
      source: 'default',
      createdAt: Date.now(),
      ...fields,
    };
  });
}

async function loadAndParse(path: string): Promise<DataRecord[]> {
  const raw = await readFile(join(path), 'utf-8');
  return parseCsv(raw);
}

async function saveRecords(records: DataRecord[], path: string): Promise<void> {
  const lines = records.map(r => JSON.stringify(r));
  await writeFile(path, lines.join('\n'));
}

export async function processData(inputPath: string, outputPath: string) {
  const records = await loadAndParse(inputPath);
  const cleaned = records.filter(r => r.name !== 'unknown');
  await saveRecords(cleaned, outputPath);
  return { count: cleaned.length, skipped: records.length - cleaned.length };
}

export function analyzeLine(line: string): { words: number; chars: number } {
  return { words: line.split(' ').length, chars: line.length };
}
`;

const t0 = performance.now();
const result = await optimizeContext(code, {
  strategy: 'adaptive',
  taskType: 'bug-fix',
  taskPrompt: 'fix the parse error in processCsv reading files',
  targetTokens: 2000,
});
const t1 = performance.now();

console.log('=== PROBE ===');
console.log('originalTokens:', result.originalTokens);
console.log('optimizedTokens:', result.optimizedTokens);
console.log('reductionPercent:', result.reductionPercent);
console.log('includedSymbols:', result.includedSymbols.join(', '));
console.log('strategy used:', result.strategy);
console.log('time ms:', Math.round(t1 - t0));
console.log('callGraph nodes:', result.callGraphStats?.totalNodes);
console.log('=== OUTPUT (first 600 chars) ===');
console.log(result.code.slice(0, 600));
