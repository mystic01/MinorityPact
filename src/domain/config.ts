import { array, integer, keys, object, oneOf, text } from '../contracts/validation.ts';
export interface Rules {
  contractsEnabled?: boolean;
  players: string[]; rounds: number; negotiationTimeMs: number;
  scoring: { policy: 'exclusive' | 'zero_sum'; solo: number; pair: number; majority: number };
  policies: { ready: 'revocable_quiet_batch'; vote: 'commit_once'; simultaneous: 'next_batch'; messageTiming?: 'immediate' | 'scheduled' };
}
export interface SessionConfig extends Rules {
  decisionMode?: 'manual_file';
  humanSeat?: string;
  schemaVersion: 1; experimental: true; rulesVersion: string; promptVersion: string; seed: string;
  scheduling: { mode: 'fixed_5s' | 'fixed_15s' | 'event_driven'; eventReactionMs: number; privateMessageWake?: 'always' | 'subscribed'; reconsiderAfterMs?: number };
  llm: { provider: 'openrouter'; model: string; displayName?: string; parameters: Record<string, unknown> };
  seatModels?: Record<string, { model: string; displayName?: string }>;
}
export function parseConfig(value: unknown): SessionConfig {
  const v = object(value);
  keys(v, ['schemaVersion', 'experimental', 'rulesVersion', 'promptVersion', 'seed', 'players', 'rounds', 'negotiationTimeMs', 'scoring', 'policies', 'scheduling', 'llm', 'seatModels', 'humanSeat', 'decisionMode', 'contractsEnabled']);
  if (v.schemaVersion !== 1 || v.experimental !== true) throw new Error('Expected experimental schema v1');
  const players = array(v.players).map(text);
  if (players.length !== 5 || new Set(players).size !== 5 || players.some(id => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id))) throw new Error('Exactly five distinct safe seat IDs required');
  const rounds = integer(v.rounds, 5); if (rounds !== 5 && (rounds < 10 || rounds > 12)) throw new Error('Expected 5 or 10–12 rounds');
  const s = object(v.scoring); keys(s, ['policy', 'solo', 'pair', 'majority']);
  const scoring = { policy: oneOf(s.policy, ['exclusive', 'zero_sum']), solo: integer(s.solo), pair: integer(s.pair), majority: integer(s.majority, -Number.MAX_SAFE_INTEGER) };
  if (scoring.policy === 'exclusive' && scoring.majority !== 0) throw new Error('Exclusive majority must be zero');
  if (scoring.policy === 'zero_sum' && (scoring.solo + 4 * scoring.majority !== 0 || 2 * scoring.pair + 3 * scoring.majority !== 0)) throw new Error('Not zero sum');
  const p = object(v.policies); keys(p, ['ready', 'vote', 'simultaneous', 'messageTiming']);
  const t = object(v.scheduling); keys(t, ['mode', 'eventReactionMs', 'privateMessageWake', 'reconsiderAfterMs']);
  const l = object(v.llm); keys(l, ['provider', 'model', 'displayName', 'parameters']);
  const parameters = object(l.parameters);
  // Do not permit credentials or per-seat/provider overrides in common parameters.
  const parameterKeys = ['temperature', 'top_p', 'max_tokens', 'reasoning', 'seed'];
  keys(parameters, parameterKeys);
  for (const field of ['temperature', 'top_p'] as const) {
    const n = parameters[field];
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > (field === 'temperature' ? 2 : 1))) throw new Error('Invalid sampling parameter');
  }
  if (parameters.max_tokens !== undefined) integer(parameters.max_tokens, 1);
  if (parameters.seed !== undefined) integer(parameters.seed);
  if (parameters.reasoning !== undefined) {
    const reasoning = object(parameters.reasoning); keys(reasoning, ['effort', 'max_tokens']);
    if (reasoning.effort !== undefined) oneOf(reasoning.effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    if (reasoning.max_tokens !== undefined) integer(reasoning.max_tokens, 1);
  }
  let seatModels: SessionConfig['seatModels'];
  if (v.seatModels !== undefined) {
    const seats = object(v.seatModels); keys(seats, players);
    seatModels = Object.fromEntries(players.map(id => {
      const seat = object(seats[id]); keys(seat, ['model', 'displayName']);
      return [id, { model: text(seat.model), ...(seat.displayName === undefined ? {} : { displayName: text(seat.displayName) }) }];
    }));
  }
  if (v.humanSeat !== undefined && (!players.includes(text(v.humanSeat)) || t.mode !== 'fixed_5s' || p.messageTiming !== 'immediate')) throw new Error('Human mode requires a valid seat, fixed_5s and immediate messages');
  if (v.contractsEnabled !== undefined && typeof v.contractsEnabled !== 'boolean') throw new Error('Invalid contracts setting');
  if (v.decisionMode !== undefined) oneOf(v.decisionMode, ['manual_file']);
  if (v.decisionMode === 'manual_file' && v.humanSeat) throw new Error('Manual files require all AI seats');
  return {
    ...(v.contractsEnabled === undefined ? {} : { contractsEnabled: v.contractsEnabled as boolean }),
    ...(v.decisionMode === 'manual_file' ? { decisionMode: 'manual_file' as const } : {}),
    ...(v.humanSeat === undefined ? {} : { humanSeat: text(v.humanSeat) }),
    ...(seatModels === undefined ? {} : { seatModels }),
    schemaVersion: 1, experimental: true, players, rounds, negotiationTimeMs: integer(v.negotiationTimeMs, 1),
    rulesVersion: text(v.rulesVersion), promptVersion: text(v.promptVersion), seed: text(v.seed), scoring,
    policies: { ready: oneOf(p.ready, ['revocable_quiet_batch']), vote: oneOf(p.vote, ['commit_once']), simultaneous: oneOf(p.simultaneous, ['next_batch']), ...(p.messageTiming === undefined ? {} : { messageTiming: oneOf(p.messageTiming, ['immediate', 'scheduled']) }) },
    scheduling: { mode: oneOf(t.mode, ['fixed_5s', 'fixed_15s', 'event_driven']), eventReactionMs: integer(t.eventReactionMs, 1), ...(t.privateMessageWake === undefined ? {} : { privateMessageWake: oneOf(t.privateMessageWake, ['always', 'subscribed']) }), ...(t.reconsiderAfterMs === undefined ? {} : { reconsiderAfterMs: integer(t.reconsiderAfterMs, 1) }) },
    llm: { provider: oneOf(l.provider, ['openrouter']), model: text(l.model), parameters: structuredClone(parameters), ...(l.displayName === undefined ? {} : { displayName: text(l.displayName) }) },
  };
}
export function modelForSeat(config: SessionConfig, id: string, outputTokenFloor?: number): SessionConfig['llm'] {
  if (!config.players.includes(id)) throw new Error('Unknown seat');
  const seat = config.seatModels?.[id];
  const model = seat?.model ?? config.llm.model;
  const parameters = structuredClone(config.llm.parameters);
  // Live deployment may raise a saved session's output allowance without changing
  // its frozen rules, model, snapshots or existing successful decisions.
  if (outputTokenFloor !== undefined) {
    integer(outputTokenFloor, 1);
    const savedLimit = parameters.max_tokens;
    parameters.max_tokens = Math.max(typeof savedLimit === 'number' ? savedLimit : 0, outputTokenFloor);
  }
  // These reasoning models have exhausted the entire output budget without final JSON.
  // Apply at resolution time so saved sessions also benefit, without rewriting their config.
  if (parameters.reasoning === undefined) {
    if (/^z-ai\/glm-5\.3(?:-flash)?$/.test(model)) parameters.reasoning = { effort: 'low' };
    // Qwen advertises supports_max_tokens, not supported_efforts. A low effort
    // request still exhausted 4096 reasoning tokens in the local private audit.
    if (model === 'qwen/qwen3.8-flash') {
      const total = parameters.max_tokens;
      parameters.reasoning = typeof total === 'number' && total <= 1024
        ? { effort: 'none' }
        : { max_tokens: 1024 };
    }
  }
  return { ...config.llm, ...(seat ? { model: seat.model, displayName: seat.displayName ?? seat.model } : {}), parameters };
}
