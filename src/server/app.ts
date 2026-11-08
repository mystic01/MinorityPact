import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseConfig, modelForSeat } from '../domain/config.ts';
import type { SessionConfig } from '../domain/config.ts';
import type { AgentController } from '../contracts/decision.ts';
import { SqliteEventStore } from '../infrastructure/sqlite-store.ts';
import { ReplayService } from '../application/replay.ts';
import { DecisionCoordinator } from '../application/coordinator.ts';
import { humanDecision } from '../application/human.ts';
import { ManualFileController } from '../controllers/manual-file.ts';
import { OpenRouterController } from '../controllers/openrouter.ts';

type Status = 'waiting_manual' | 'waiting_human' | 'idle' | 'running' | 'advancing' | 'paused' | 'paused_error' | 'completed' | 'aborted';
export interface AppOptions { manualRoot?: string; store: SqliteEventStore; config: SessionConfig; apiKey?: string; assets?: string; controllers?: (config: SessionConfig, id: string) => Record<string, AgentController>; pace?: (ms: number) => Promise<void> }
export function createApp(options: AppOptions) {
  const { store } = options; const replay = new ReplayService(store);
  const token = randomBytes(32).toString('hex');
  const states = new class extends Map<string, Status> {
    override set(id: string, status: Status) { store.setStatus(id, status); return super.set(id, status); }
  }();
  for (const id of store.listSessions()) {
    const status = store.getStatus(id) as Status;
    states.set(id, ['running', 'advancing', 'paused', 'waiting_manual'].includes(status) ? 'paused_error' : status);
  }
  const manualStates = new Map<string, Record<string, string>>();
  const manualDirectory = (id: string) => resolve(options.manualRoot ?? 'data/manual', id);
  let stopped = false;
  let active: string | null = null;
  const clocks = new Map<string, number>();
  const statusFor = (id: string, phase: string) => states.get(id) === 'aborted' ? 'aborted' : phase === 'completed' ? 'completed' : states.get(id) ?? 'idle';
  const errorFor = async (id: string) => {
    if (states.get(id) !== 'paused_error') return undefined;
    const cp = await store.loadCheckpoint(id);
    const failedSnapshots = cp?.pendingDecisions.filter(p => !p.result).map(p => p.snapshot.snapshotId) ?? [];
    const failure = store.readAudit(id, failedSnapshots).filter(a => a.kind === 'decision_rejected').at(-1);
    if (failure?.code === 'output_token_limit') return '模型的輸出／推理額度已耗盡，回覆被截斷。已停止自動重試並保留進度，請調整推理強度或輸出上限後再繼續。';
    if (failure?.code === 'http_402') return 'OpenRouter 額度不足或無法負擔此次輸出預留上限。已停止自動重試並保留進度。';
    if (failure?.code === 'http_429') return '模型供應商暫時限制請求（HTTP 429）。已停止立即重試並保留進度，請稍後按「繼續對局」；已成功的席位不會重複呼叫。';
    return undefined;
  };
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const run = (id: string) => {
    if (active || states.get(id) === 'aborted') throw new Error('Unavailable');
    const config = store.getConfig(id);
    const manual = config.decisionMode === 'manual_file';
    if (!manual && !options.controllers && !options.apiKey) throw new Error('Missing key');
    if (manual) manualStates.set(id, {});
    const controllers = manual ? Object.fromEntries(config.players.map(agent => [agent, new ManualFileController(manualDirectory(id), (seat, status) => { manualStates.get(id)![seat] = status; }, true)])) : options.controllers?.(config, id) ?? Object.fromEntries(config.players.filter(agent => agent !== config.humanSeat).map(agent => [agent, new OpenRouterController(modelForSeat(config, agent, typeof options.config.llm.parameters.max_tokens === 'number' ? options.config.llm.parameters.max_tokens : undefined), options.apiKey!, (snapshot, record) => store.recordAudit(id, snapshot, record))]));
    active = id; states.set(id, 'running');
    const c = new DecisionCoordinator(store, id, controllers);
    void (async () => {
      try {
        while (!stopped && states.get(id) !== 'aborted') {
          while (!stopped && states.get(id) === 'paused') await delay(50);
          if (stopped || states.get(id) === 'aborted') break;
          const result = await c.step(async ms => {
            if (ms && !config.humanSeat && !manual) {
              if (states.get(id) !== 'paused') states.set(id, 'advancing');
              const base = (await store.loadCheckpoint(id))?.logicalTimeMs ?? 0;
              clocks.set(id, base);
              if (options.pace) await options.pace(ms);
              else for (let elapsed = 0; elapsed < ms; elapsed += Math.min(100, ms - elapsed)) {
                while (!stopped && states.get(id) === 'paused') await delay(50);
                if (states.get(id) === 'aborted') throw new Error('Aborted');
                await delay(Math.min(100, ms - elapsed));
                clocks.set(id, base + elapsed + Math.min(100, ms - elapsed));
              }
            }
            if (states.get(id) === 'aborted') throw new Error('Aborted');
            if (states.get(id) !== 'paused') states.set(id, 'running');
          }, 120000);
          if (stopped || states.get(id) === 'aborted') break;
          if (result === 'waiting_manual') { if (states.get(id) !== 'paused') states.set(id, 'waiting_manual'); await delay(1000); continue; }
          if (result === 'waiting_human') { if (states.get(id) !== 'paused') states.set(id, 'waiting_human'); break; }
          if (result === 'completed') { states.set(id, 'completed'); break; }
        }
      } catch { if (states.get(id) !== 'aborted') states.set(id, 'paused_error'); }
      finally { active = null; }
    })();
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      // Loopback host + same-origin checks protect the bootstrap token from rebinding/cross-site reads.
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(res, 403, { error: 'Forbidden host' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Forbidden origin' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Forbidden site' });
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.pathname === '/api/bootstrap') return json(res, 200, { token, hasKey: Boolean(options.apiKey), config: { ...options.config,
        seatModels: Object.fromEntries(options.config.players.map(id => { const m = modelForSeat(options.config, id); return [id, { model: m.model, displayName: m.displayName ?? m.model }]; })) } });
      if (parts[0] === 'api') {
        if (req.method === 'POST') {
          const auth = String(req.headers['x-operation-token'] ?? '');
          if (auth.length !== token.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(token))) return json(res, 403, { error: 'Forbidden' });
          if (url.pathname === '/api/sessions') {
            let raw = ''; for await (const chunk of req) { raw += String(chunk); if (raw.length > 32000) throw new Error('Too large'); }
            const config = raw ? parseConfig(JSON.parse(raw)) : structuredClone(options.config);
            if (config.decisionMode === 'manual_file') { delete config.seatModels; config.llm = { provider: 'openrouter', model: 'manual-file', displayName: '手動檔案（外部模型未驗證）', parameters: {} }; }
            const id = randomUUID(); store.createSession(id, config); states.set(id, 'idle'); return json(res, 201, { id });
          }
          const id = parts[2]!; const action = parts[3];
          const sessionConfig = store.getConfig(id);
          if (action === 'human-submit') {
            if (!sessionConfig.humanSeat || ['aborted', 'completed', 'idle'].includes(states.get(id) ?? 'idle')) throw new Error('Unavailable');
            let raw = ''; for await (const chunk of req) { raw += String(chunk); if (raw.length > 32000) throw new Error('Too large'); }
            const cp = await store.loadCheckpoint(id);
            const pending = cp?.pendingDecisions.find(p => p.snapshot.input.agentId === sessionConfig.humanSeat);
            if (!pending) throw new Error('No pending input');
            store.submitHuman(id, pending.snapshot.snapshotId, humanDecision(JSON.parse(raw), pending.snapshot.input, sessionConfig.players));
            if (!active && states.get(id) === 'waiting_human') run(id);
            return json(res, 200, { submitted: true });
          }
          if (action === 'start' || action === 'resume') {
            if (active === id && states.get(id) === 'paused') states.set(id, 'running');
            else run(id);
          } else if (action === 'pause' && (active === id || states.get(id) === 'waiting_human')) states.set(id, 'paused');
          else if (action === 'abort') states.set(id, 'aborted');
          else throw new Error('Invalid command');
          return json(res, 200, { status: states.get(id) });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
        if (url.pathname === '/api/sessions') return json(res, 200, { sessions: store.listSessions() });
        const id = parts[2]!; const action = parts[3];
        if (parts[1] !== 'sessions') throw new Error('Unknown route');
        if (action === 'manual') {
          const auth = String(req.headers['x-operation-token'] ?? '');
          if (auth.length !== token.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(token))) return json(res, 403, { error: 'Forbidden' });
          const config = store.getConfig(id);
          if (config.decisionMode !== 'manual_file') return json(res, 200, { enabled: false });
          const cp = await store.loadCheckpoint(id);
          return json(res, 200, { enabled: true, directory: manualDirectory(id), players: config.players.map(seat => {
            const p = cp?.pendingDecisions.find(p => p.snapshot.input.agentId === seat);
            return { seat, file: `player-${seat}.md`, status: p?.result ? '已接受' : p ? manualStates.get(id)?.[seat] ?? '等待回覆' : '本批無需回覆', round: p?.snapshot.input.round, phase: p?.snapshot.input.phase };
          }) });
        }
        if (action === 'player') {
          const auth = String(req.headers['x-operation-token'] ?? '');
          if (auth.length !== token.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(token))) return json(res, 403, { error: 'Forbidden' });
          const config = store.getConfig(id);
          if (!config.humanSeat) return json(res, 200, { seat: null });
          const cp = await store.loadCheckpoint(id);
          const pending = cp?.pendingDecisions.find(p => p.snapshot.input.agentId === config.humanSeat);
          const view = await replay.read(id, { kind: 'agent', agentId: config.humanSeat });
          const roundEvents = view.events.slice(view.events.findLastIndex(e => e.type === 'round_started') + 1);
          const ready = roundEvents.findLast(e => e.type === 'ready_changed')?.publicPayload.ready === true;
          const rules = pending ? JSON.parse(pending.snapshot.input.publicRules) : null;
          return json(res, 200, { seat: config.humanSeat, events: view.events, ready,
            pending: pending ? { snapshotId: pending.snapshot.snapshotId, phase: pending.snapshot.input.phase, round: pending.snapshot.input.round, logicalTimeMs: pending.snapshot.input.logicalTimeMs,
              windowIndex: rules ? Math.floor((pending.snapshot.input.logicalTimeMs - rules.roundStartedMs) / 5000) + 1 : 1, windowCount: Math.ceil(config.negotiationTimeMs / 5000),
              submitted: Boolean(pending.result || store.humanSubmission(id, pending.snapshot.snapshotId)) } : null });
        }
        if (action === 'stream') {
          // Live stream always stays public, including after completion.
          let cursor = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid cursor');
          store.getConfig(id);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          let busy = false;
          const send = async () => {
            if (busy) return; busy = true;
            try {
              const view = await replay.read(id, { kind: 'spectator' }, Number.MAX_SAFE_INTEGER, cursor);
              cursor = view.lastSeq;
              res.write(`id: ${cursor}\nevent: snapshot\ndata: ${JSON.stringify({ ...view, errorMessage: await errorFor(id), clockTimeMs: states.get(id) === 'advancing' ? clocks.get(id) ?? view.state.logicalTimeMs : view.state.logicalTimeMs, status: statusFor(id, view.state.phase) })}\n\n`);
            } catch { res.end(); } finally { busy = false; }
          };
          await send(); const timer = setInterval(() => { void send(); }, 500);
          req.on('close', () => clearInterval(timer)); return;
        }
        const omniscient = action === 'replay' && url.searchParams.get('view') === 'omniscient';
        if (action === 'timeline') {
          if (states.get(id) === 'aborted') throw new Error('Replay locked');
          return json(res, 200, await replay.timeline(id));
        }
        const through = Number(url.searchParams.get('through') ?? Number.MAX_SAFE_INTEGER);
        const after = Number(url.searchParams.get('after') ?? 0);
        if (omniscient && states.get(id) === 'aborted') throw new Error('Aborted replay locked');
        const view = await replay.read(id, { kind: omniscient ? 'omniscient' : 'spectator' }, through, after);
        return json(res, 200, { ...view, errorMessage: await errorFor(id), status: statusFor(id, view.state.phase) });
      }
      const root = resolve(options.assets ?? 'dist');
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const path = resolve(root, `.${relative}`);
      if (!path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`)) return json(res, 403, { error: 'Forbidden' });
      const content = readFileSync(path);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; frame-ancestors 'none'" });
      res.end(content);
    } catch { if (!res.headersSent) json(res, 400, { error: 'Request unavailable; check configuration, key or session state.' }); else res.end(); }
  });
  return { server, stop: () => { stopped = true; if (active) states.set(active, store.getConfig(active).decisionMode === 'manual_file' ? 'paused' : 'aborted'); server.closeAllConnections(); server.close(); } };
}
