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
import { OpenRouterController } from '../controllers/openrouter.ts';

type Status = 'idle' | 'running' | 'advancing' | 'paused' | 'paused_error' | 'completed' | 'aborted';
export interface AppOptions { store: SqliteEventStore; config: SessionConfig; apiKey?: string; assets?: string; controllers?: (config: SessionConfig, id: string) => Record<string, AgentController>; pace?: (ms: number) => Promise<void> }
export function createApp(options: AppOptions) {
  const { store } = options; const replay = new ReplayService(store);
  const token = randomBytes(32).toString('hex');
  const states = new class extends Map<string, Status> {
    override set(id: string, status: Status) { store.setStatus(id, status); return super.set(id, status); }
  }();
  for (const id of store.listSessions()) {
    const status = store.getStatus(id) as Status;
    states.set(id, ['running', 'advancing', 'paused'].includes(status) ? 'paused_error' : status);
  }
  let active: string | null = null;
  const clocks = new Map<string, number>();
  const statusFor = (id: string, phase: string) => states.get(id) === 'aborted' ? 'aborted' : phase === 'completed' ? 'completed' : states.get(id) ?? 'idle';
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const run = (id: string) => {
    if (active || states.get(id) === 'aborted') throw new Error('Unavailable');
    const config = store.getConfig(id);
    if (!options.controllers && !options.apiKey) throw new Error('Missing key');
    const controllers = options.controllers?.(config, id) ?? Object.fromEntries(config.players.map(agent => [agent, new OpenRouterController(modelForSeat(config, agent), options.apiKey!, (snapshot, record) => store.recordAudit(id, snapshot, record))]));
    active = id; states.set(id, 'running');
    const c = new DecisionCoordinator(store, id, controllers);
    void (async () => {
      try {
        while (states.get(id) !== 'aborted') {
          while (states.get(id) === 'paused') await delay(50);
          if (states.get(id) === 'aborted') break;
          const result = await c.step(async ms => {
            if (ms) {
              if (states.get(id) !== 'paused') states.set(id, 'advancing');
              const base = (await store.loadCheckpoint(id))?.logicalTimeMs ?? 0;
              clocks.set(id, base);
              if (options.pace) await options.pace(ms);
              else for (let elapsed = 0; elapsed < ms; elapsed += Math.min(100, ms - elapsed)) {
                while (states.get(id) === 'paused') await delay(50);
                if (states.get(id) === 'aborted') throw new Error('Aborted');
                await delay(Math.min(100, ms - elapsed));
                clocks.set(id, base + elapsed + Math.min(100, ms - elapsed));
              }
            }
            if (states.get(id) === 'aborted') throw new Error('Aborted');
            if (states.get(id) !== 'paused') states.set(id, 'running');
          }, 120000);
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
      if (url.pathname === '/api/bootstrap') return json(res, 200, { token, hasKey: Boolean(options.apiKey), config: options.config });
      if (parts[0] === 'api') {
        if (req.method === 'POST') {
          const auth = String(req.headers['x-operation-token'] ?? '');
          if (auth.length !== token.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(token))) return json(res, 403, { error: 'Forbidden' });
          if (url.pathname === '/api/sessions') {
            let raw = ''; for await (const chunk of req) { raw += String(chunk); if (raw.length > 32000) throw new Error('Too large'); }
            const config = raw ? parseConfig(JSON.parse(raw)) : options.config;
            const id = randomUUID(); store.createSession(id, config); states.set(id, 'idle'); return json(res, 201, { id });
          }
          const id = parts[2]!; const action = parts[3];
          store.getConfig(id);
          if (action === 'start' || action === 'resume') {
            if (active === id && states.get(id) === 'paused') states.set(id, 'running');
            else run(id);
          } else if (action === 'pause' && active === id) states.set(id, 'paused');
          else if (action === 'abort') states.set(id, 'aborted');
          else throw new Error('Invalid command');
          return json(res, 200, { status: states.get(id) });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
        if (url.pathname === '/api/sessions') return json(res, 200, { sessions: store.listSessions() });
        const id = parts[2]!; const action = parts[3];
        if (parts[1] !== 'sessions') throw new Error('Unknown route');
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
              res.write(`id: ${cursor}\nevent: snapshot\ndata: ${JSON.stringify({ ...view, clockTimeMs: states.get(id) === 'advancing' ? clocks.get(id) ?? view.state.logicalTimeMs : view.state.logicalTimeMs, status: statusFor(id, view.state.phase) })}\n\n`);
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
        return json(res, 200, { ...view, status: statusFor(id, view.state.phase) });
      }
      const root = resolve(options.assets ?? 'dist');
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const path = resolve(root, `.${relative}`);
      if (!path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`)) return json(res, 403, { error: 'Forbidden' });
      const content = readFileSync(path);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' } as Record<string, string>)[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; script-src 'self'; frame-ancestors 'none'" });
      res.end(content);
    } catch { if (!res.headersSent) json(res, 400, { error: 'Request unavailable; check configuration, key or session state.' }); else res.end(); }
  });
  return { server, stop: () => { if (active) states.set(active, 'aborted'); server.closeAllConnections(); server.close(); } };
}
