<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { PublicView, PublicEvent } from '../../src/contracts/public.ts';
import { advancePlayback } from '../../src/contracts/timeline.ts';
import type { TimelineEntry } from '../../src/contracts/timeline.ts';
type View = { state: PublicView; events: PublicEvent[]; lastSeq: number; status: string; clockTimeMs?: number; errorMessage?: string };
const token = ref(''), hasKey = ref(false), ids = ref<string[]>([]), selected = ref(''), config = ref<any>(null);
const view = ref<View | null>(null), events = ref<PublicEvent[]>([]), error = ref(''), connected = ref(false);
const replayMode = ref(false), god = ref(false), playing = ref(false), cursor = ref(0), maximum = ref(0), speed = ref(1);
let stream: EventSource | null = null, timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let timeline: TimelineEntry[] = [], playhead = 0;
const state = computed(() => view.value?.state);
const winner = computed(() => state.value?.outcome?.kind === 'winner' ? `${state.value.outcome.agentId} 獨占冠軍` : state.value?.outcome?.kind === 'draw' ? `${state.value.outcome.agentIds.join(' / ')} 平手` : '賽局結束');
function setScoring(policy: string) { config.value.scoring = policy === 'zero_sum' ? { policy, solo: 8, pair: 3, majority: -2 } : { policy: 'exclusive', solo: 5, pair: 2, majority: 0 }; }
const phases: Record<string, string> = { negotiation: '自由交涉', commit: '秘密投票', reveal: '揭曉與計分', completed: '賽局結束' };
const statusLabel = computed(() => replayMode.value ? '重播檢視' : ({ running: '等待 AI 決策 · 遊戲時鐘暫停', advancing: '交涉進行中', paused: '已暫停', paused_error: '對局暫停 · 請檢查私有稽核紀錄後重試', completed: '已完局 · 可解鎖上帝視角', aborted: '已中止', idle: '準備開始' } as Record<string, string>)[view.value?.status ?? 'idle']);
const time = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const remaining = computed(() => Math.max(0, (state.value?.negotiationTimeMs ?? 0) - ((view.value?.clockTimeMs ?? state.value?.logicalTimeMs ?? 0) - (state.value?.roundStartedMs ?? 0))));
const votes = computed(() => ['reveal', 'completed'].includes(state.value?.phase ?? '') ? [...events.value].reverse().find(e => e.type === 'votes_revealed')?.publicPayload.votes as Record<string, string> | undefined : undefined);
const models = ['z-ai/glm-5.3-flash', 'qwen/qwen3.8-flash', 'deepseek/deepseek-v3.2', 'google/gemini-2.5-flash-lite', 'z-ai/glm-5.3', 'google/gemini-2.5-flash', 'google/gemini-2.5-pro', 'google/gemini-3.5-flash', 'google/gemini-3.5-flash-lite'];
async function api(path: string, body?: unknown) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Token': token.value }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('操作未完成：請確認 API key、設定或對局狀態。'); return r.json();
}
async function refreshList() { ids.value = (await api('/api/sessions')).sessions; }
function closeStream() { stream?.close(); stream = null; connected.value = false; generation++; }
async function watchSession() {
  closeStream(); playing.value = false; replayMode.value = false; god.value = false; events.value = []; view.value = null;
  if (!selected.value) return;
  const current = generation;
  try {
    const initial = await api(`/api/sessions/${selected.value}`) as View; if (current !== generation) return;
    view.value = initial; events.value = initial.events;
    stream = new EventSource(`/api/sessions/${selected.value}/stream?after=${initial.lastSeq}`);
    stream.addEventListener('snapshot', e => {
      if (current !== generation) return;
      const next = JSON.parse((e as MessageEvent).data) as View;
      const seen = new Set(events.value.map(e => e.eventId)); events.value.push(...next.events.filter(e => !seen.has(e.eventId)));
      view.value = next; maximum.value = next.lastSeq; connected.value = true;
    });
    stream.onerror = () => { connected.value = false; };
  } catch (e) { error.value = String(e); }
}
async function createSession() {
  try { error.value = ''; const created = await api('/api/sessions', config.value); await refreshList(); selected.value = created.id; await watchSession(); }
  catch (e) { error.value = String(e); }
}
async function command(action: string) { try { error.value = ''; await api(`/api/sessions/${selected.value}/${action}`, {}); } catch (e) { error.value = String(e); } }
async function enterReplay() {
  closeStream(); replayMode.value = true; cursor.value = 0; playhead = 0; events.value = [];
  try { const manifest = await api(`/api/sessions/${selected.value}/timeline`); timeline = manifest.entries; maximum.value = manifest.lastSeq; await seek(); }
  catch (e) { error.value = String(e); }
}
let seekVersion = 0;
async function seek(fromPlayback = false) {
  if (fromPlayback !== true) playhead = timeline.find(e => e.commitSeq === cursor.value)?.logicalTimeMs ?? 0;
  const version = ++seekVersion; events.value = []; // Clear secret cache before any mode change/request.
  try {
    const next = await api(`/api/sessions/${selected.value}/replay?view=${god.value ? 'omniscient' : 'public'}&through=${cursor.value}`) as View;
    if (version !== seekVersion || !replayMode.value) return; view.value = next; events.value = next.events;
  } catch (e) { playing.value = false; error.value = String(e); }
}
function describe(e: PublicEvent): string {
  const p = e.publicPayload;
  switch (e.type) {
    case 'public_message': return String(p.body);
    case 'private_message_sent': return p.body ? String(p.body) : '私訊內容將於終局重播解鎖';
    case 'phase_changed': return phases[String(p.phase)] ?? String(p.phase);
    case 'round_started': return `第 ${p.round} 回合開始`;
    case 'votes_revealed': return '五席選色已統一揭曉';
    case 'scores_updated': return '本輪分數已更新';
    case 'game_ended': { const o = p.outcome as { kind: string; agentId?: string; agentIds?: string[] }; return o.kind === 'winner' ? `${o.agentId} 獲得獨占冠軍` : `${o.agentIds?.join('、')} 平手`; }
    case 'strategy_note': return '當時保存的私人策略備忘錄';
    case 'vote_committed': return `秘密投票：${p.color === 'red' ? '紅色' : '藍色'}`;
    default: return e.type;
  }
}
onMounted(async () => {
  try { const initial = await api('/api/bootstrap'); token.value = initial.token; hasKey.value = initial.hasKey; config.value = initial.config; await refreshList(); if (ids.value[0]) { selected.value = ids.value[0]; await watchSession(); } }
  catch (e) { error.value = String(e); }
  timer = setInterval(() => { if (playing.value && replayMode.value) { const next = advancePlayback(timeline, playhead, 250, speed.value); playhead = next.logicalTimeMs; if (next.cursor !== cursor.value) { cursor.value = next.cursor; void seek(true); } if (next.ended) playing.value = false; } }, 250);
});
onUnmounted(() => { closeStream(); clearInterval(timer); });
</script>

<template>
  <div class="shell">
    <header><a class="brand" href="/">MP<span>少數者密約<small>MINORITY PACT / OBSERVATORY</small></span></a><div class="signal"><i :class="{ online: connected }"></i>{{ connected ? 'LIVE CONNECTED' : replayMode ? 'REPLAY ARCHIVE' : 'LOCAL SESSION' }}</div></header>
    <main>
      <div class="intro"><div><p class="eyebrow">FIVE MINDS. TWO COLORS. ONE CHAMPION.</p><h1>真心，藏在選擇之後。</h1><p class="muted">閱讀公開線索，追蹤私下往來。待終局，再回到真相發生的時刻。</p></div><span class="edition">EXPERIMENT<br><b>01 / 少數派</b></span></div>
      <div v-if="error || view?.errorMessage" class="notice" role="alert">{{ error || view?.errorMessage }} <button v-if="error" @click="error = ''">關閉</button></div>
      <section class="toolbar"><label>歷史對局 <select v-model="selected" @change="watchSession"><option value="">選擇對局</option><option v-for="id in ids" :key="id" :value="id">{{ id.slice(0, 12) }}</option></select></label><div class="actions"><button v-if="selected" @click="watchSession">即時視角</button><button :disabled="!state || state.phase !== 'completed'" @click="enterReplay">終局重播 ↗</button></div></section>
      <div class="dashboard">
        <section class="arena panel"><div class="section-top"><span class="eyebrow">THE TABLE</span><span v-if="state">ROUND {{ String(state.round).padStart(2, '0') }} / {{ state.rounds }}</span></div>
          <div v-if="state" class="game-heading"><h2>{{ state.phase === 'completed' ? winner : phases[state.phase] }}</h2><span class="clock">{{ state.phase === 'negotiation' ? time(remaining) : '—:—' }}<small>交涉剩餘遊戲時間</small></span></div>
          <div v-else class="game-heading"><h2>等待入席</h2><span class="muted">建立一場新的博弈</span></div>
          <div class="table-area"><div class="table-ring"><span>MINORITY<br><strong>紅 / 藍</strong><small>承諾不具強制力</small></span></div><div class="seats"><article v-for="(s, i) in state?.standings ?? config?.players?.map((id: string) => ({ agentId: id, score: 0, minorityWins: 0 })) ?? []" :key="s.agentId" class="seat" :class="`seat-${i}`"><div class="seat-top"><b>{{ s.agentId }}</b><span v-if="votes?.[s.agentId]" class="vote" :class="votes[s.agentId]">{{ votes[s.agentId] === 'red' ? '紅' : '藍' }}</span></div><h3>{{ (state?.seatModels ?? config?.seatModels)?.[s.agentId]?.displayName ?? state?.model?.displayName ?? 'AI' }}</h3><p><strong>{{ s.score }}</strong> 分 <span>少數派 {{ s.minorityWins }} 次</span></p></article></div></div>
          <div class="status-line"><i></i>{{ statusLabel }}<small>OPENROUTER / {{ state?.seatModels ? '多模型對局' : state?.model?.model ?? '設定檔模型' }}</small></div>
          <div v-if="selected && !replayMode" class="controls"><button class="primary" :disabled="!hasKey || ['running','advancing','completed','aborted'].includes(view?.status ?? '')" @click="command(view?.status === 'idle' ? 'start' : 'resume')">{{ view?.status === 'idle' ? '開始對局' : '繼續對局' }}</button><button :disabled="!['running','advancing'].includes(view?.status ?? '')" @click="command('pause')">暫停</button><button :disabled="['completed','aborted'].includes(view?.status ?? '')" @click="command('abort')">中止</button></div>
        </section>
        <section class="feed panel"><div class="section-top"><span class="eyebrow">EVENT JOURNAL</span><span>{{ god && replayMode ? '上帝視角' : '限知視角' }}</span></div><h2>言語與暗流<span>{{ events.length }} EVENTS</span></h2><div class="event-list" aria-live="polite"><p v-if="!events.length" class="empty">尚無事件。沉默也可能是一種選擇。</p><article v-for="e in events" :key="e.eventId" class="event" :class="{ private: e.type === 'private_message_sent' }"><div class="event-meta"><time>{{ time(e.logicalTimeMs) }}</time><b>{{ e.publicPayload.sender ?? e.publicPayload.actorId ?? 'SYSTEM' }}<template v-if="e.publicPayload.recipient"> → {{ e.publicPayload.recipient }}</template></b><span>{{ e.type === 'private_message_sent' ? '私訊' : e.type === 'public_message' ? '公開' : '紀錄' }}</span></div><p>{{ describe(e) }}</p><details v-if="e.type === 'strategy_note'"><summary>查看原始備忘錄</summary><pre>{{ JSON.stringify(e.publicPayload.note, null, 2) }}</pre></details><small class="batch">批次 {{ e.batchId }} · #{{ e.commitSeq }}</small></article></div></section>
      </div>
      <section v-if="replayMode" class="replay panel"><div class="section-top"><span class="eyebrow">REPLAY / 原始事件存檔</span><label><input v-model="god" type="checkbox" @change="seek()"> 解鎖私訊與策略</label></div><div class="replay-controls"><button @click="playing = !playing">{{ playing ? '暫停' : '播放' }}</button><input v-model.number="cursor" aria-label="重播事件位置" type="range" min="0" :max="maximum" @input="playing = false; seek()"><span>{{ cursor }} / {{ maximum }}</span><select v-model.number="speed" aria-label="播放速度"><option :value="1">1×</option><option :value="2">2×</option><option :value="5">5×</option><option :value="16">16×</option></select></div></section>
      <section v-if="config" class="setup panel"><div class="section-top"><span class="eyebrow">NEXT SESSION</span><span>每席不同模型 · 規則一致</span></div><h2>下一場，由誰入席？</h2><div class="model-grid"><label v-for="id in config.players" :key="id">席位 {{ id }}<select v-model="config.seatModels[id].model" @change="config.seatModels[id].displayName = config.seatModels[id].model.split('/')[1]"><option v-if="!models.includes(config.seatModels[id].model)" :value="config.seatModels[id].model">{{ config.seatModels[id].displayName }}</option><option v-for="m in models" :key="m" :value="m">{{ m.split('/')[1] }}</option></select></label></div><div class="experiment-settings"><label>回合 <select v-model.number="config.rounds"><option :value="10">10</option><option :value="12">12</option></select></label><label>計分 <select :value="config.scoring.policy" @change="setScoring(($event.target as HTMLSelectElement).value)"><option value="exclusive">B · 獨占獎勵</option><option value="zero_sum">C · 零和轉移</option></select></label><label>同步方式 <select v-model="config.scheduling.mode"><option value="fixed_5s">5 秒窗口</option><option value="fixed_15s">15 秒窗口</option><option value="event_driven">事件驅動</option></select></label><label>交涉上限 <input v-model.number="config.negotiationTimeMs" type="number" min="1000" step="1000" aria-label="交涉上限毫秒"> ms</label></div><div class="setup-bottom"><span class="muted">設定只套用下一場，當局設定維持不變。<br><small v-if="!hasKey">尚未設定 OPENROUTER_API_KEY；仍可建立對局與查看歷史。</small></span><button class="primary" @click="createSession">建立新對局 ＋</button></div></section>
      <footer>MINORITY PACT <span>無劇本。無預設勝者。只保留當時發生的事。</span><span>LOCAL OBSERVATORY — V0.1</span></footer>
    </main>
  </div>
</template>
