export interface TimelineEntry { commitSeq: number; logicalTimeMs: number }
export function advancePlayback(timeline: TimelineEntry[], currentTime: number, elapsedMs: number, speed: number) {
  if (elapsedMs < 0 || !Number.isFinite(elapsedMs) || speed <= 0 || !Number.isFinite(speed)) throw new Error('Invalid playback delta');
  const end = timeline.at(-1)?.logicalTimeMs ?? 0;
  const logicalTimeMs = Math.min(end, currentTime + elapsedMs * speed);
  const cursor = timeline.filter(e => e.logicalTimeMs <= logicalTimeMs).at(-1)?.commitSeq ?? 0;
  return { logicalTimeMs, cursor, ended: logicalTimeMs >= end };
}
