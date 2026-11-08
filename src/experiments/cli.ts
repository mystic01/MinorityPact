import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseConfig } from '../domain/config.ts';
import { SqliteEventStore } from '../infrastructure/sqlite-store.ts';
import { experimentMatrix, summarize } from './report.ts';
const [command, path, id] = process.argv.slice(2);
if (command === 'matrix' && path) {
  const config = parseConfig(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
  mkdirSync('data/matrix', { recursive: true });
  for (const c of experimentMatrix(config)) writeFileSync(`data/matrix/${c.rounds}-${c.scheduling.mode}-${c.scoring.policy}.json`, JSON.stringify(c, null, 2));
  console.log('Created 12 experimental configs in data/matrix. No API requests made.');
} else if (command === 'report' && path && id) {
  const store = new SqliteEventStore(path);
  try { console.log(JSON.stringify(await summarize(store, id), null, 2)); } finally { store.close(); }
} else { console.error('Usage: npm run experiment -- matrix CONFIG | report DATABASE SESSION_ID'); process.exitCode = 1; }
