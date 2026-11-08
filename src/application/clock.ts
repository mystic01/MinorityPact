// Wall time is injected so tests can vary API latency without sleeping.
export class GameClock {
  private logical: number;
  private anchor: number;
  private frozen = false;
  private now: () => number;
  constructor(logicalTimeMs = 0, now = () => Date.now()) { this.logical = logicalTimeMs; this.now = now; this.anchor = now(); }
  read(): number { return this.logical + (this.frozen ? 0 : Math.max(0, this.now() - this.anchor)); }
  pause(): void { this.logical = this.read(); this.frozen = true; }
  resume(): void { this.anchor = this.now(); this.frozen = false; }
  seekBoundary(time: number): void {
    if (!Number.isSafeInteger(time) || time < this.logical) throw new Error('Clock regression');
    this.logical = time; this.anchor = this.now(); this.frozen = true;
  }
}
