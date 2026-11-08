import { readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { parseConfig, modelForSeat } from './domain/config.ts';
import { SqliteEventStore } from './infrastructure/sqlite-store.ts';
import { OpenRouterController } from './controllers/openrouter.ts';
import { DecisionCoordinator } from './application/coordinator.ts';
import { ReplayService } from './application/replay.ts';

async function main(): Promise<void> {
  const [command, configPath, databasePath = 'data/games.sqlite', givenId] = process.argv.slice(2);
  if (!['check', 'start', 'resume'].includes(command ?? '') || !configPath || command === 'resume' && !givenId) throw new Error('Usage: npm run game -- check|start|resume CONFIG [DATABASE] [SESSION_ID]');
  const config = parseConfig(JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')));
  if (command === 'check') { console.log(`Valid config: OpenRouter · ${config.llm.displayName ?? config.llm.model}`); return; }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) throw new Error('Set OPENROUTER_API_KEY before starting');
  const database = resolve(databasePath); mkdirSync(dirname(database), { recursive: true });
  // Exclusive process lock: avoid concurrent CLI writers and duplicate paid requests.
  const lockPath = `${database}.lock`; const lock = openSync(lockPath, 'wx');
  let store: SqliteEventStore | undefined;
  try {
    store = new SqliteEventStore(database);
    const id = givenId ?? randomUUID();
    if (command === 'start') store.createSession(id, config);
    const actual = store.getConfig(id); // Resume always uses frozen session settings.
    const activeStore = store;
    const controllers = Object.fromEntries(actual.players.map(agent => [agent, new OpenRouterController(modelForSeat(actual, agent), key, (snapshot, audit) => activeStore.recordAudit(id, snapshot, audit))]));
    const coordinator = new DecisionCoordinator(store, id, controllers);
    const replay = new ReplayService(store); let after = 0;
    console.log(`Session ${id} · OpenRouter · ${actual.llm.displayName ?? actual.llm.model}`);
    for (;;) {
      const status = await coordinator.step(async ms => { if (ms) { console.log(`Game clock advancing ${ms}ms`); await setTimeout(ms); } }, 120000);
      const view = await replay.read(id, { kind: 'spectator' }, Number.MAX_SAFE_INTEGER, after);
      for (const event of view.events) console.log(JSON.stringify(event));
      after = view.lastSeq;
      if (status === 'completed') { console.log('Completed'); break; }
    }
  } finally { store?.close(); closeSync(lock); unlinkSync(lockPath); }
}
main().catch(() => { console.error('Game stopped. Check config/model/key, database lock, or private audit. Pending decisions are retained for resume.'); process.exitCode = 1; });
