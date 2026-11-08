import type { SessionConfig } from '../domain/config.ts';
import type { GameState } from '../domain/engine.ts';
import type { SchedulerCheckpoint } from './ports.ts';
export function alignTime(time: number, config: SessionConfig, roundStart: number): number {
  const width = config.scheduling.mode === 'fixed_5s' ? 5000 : config.scheduling.mode === 'fixed_15s' ? 15000 : 1;
  return roundStart + Math.ceil((time - roundStart) / width) * width;
}
export function nextBoundary(state: GameState, cp: SchedulerCheckpoint, config: SessionConfig): number {
  if (!cp.initialized || cp.pendingDecisions.length || state.phase === 'commit' || state.phase === 'reveal') return cp.logicalTimeMs;
  const deadline = state.roundStartedMs + config.negotiationTimeMs;
  const times = [deadline, ...(config.humanSeat ? [cp.logicalTimeMs + 5000] : []), ...Object.values(cp.reconsiderDue ?? {}), ...cp.pendingActions.map(p => p.action.scheduledTimeMs), ...Object.values(cp.wakeQueue ?? {}),
    ...Object.values(cp.subscriptions).flatMap(w => w.atGameTimeMs === undefined ? [] : [w.atGameTimeMs])];
  if (config.players.every(id => state.ready[id])) times.push(alignTime(cp.logicalTimeMs + config.scheduling.eventReactionMs, config, state.roundStartedMs));
  return Math.min(...times.filter(t => t >= cp.logicalTimeMs));
}
