<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import PlayerSeat from './components/PlayerSeat.vue';
import { expressionFor, publicSpeech } from './presentation.ts';
import type { PublicView, PublicEvent, Standing } from '../../src/contracts/public.ts';
import { advancePlayback } from '../../src/contracts/timeline.ts';
import type { TimelineEntry } from '../../src/contracts/timeline.ts';
type View = { state: PublicView; events: PublicEvent[]; lastSeq: number; status: string; clockTimeMs?: number; errorMessage?: string };
const token = ref(''), hasKey = ref(false), ids = ref<string[]>([]), selected = ref(''), config = ref<any>(null);
const view = ref<View | null>(null), events = ref<PublicEvent[]>([]), error = ref(''), connected = ref(false);
const replayMode = ref(false), god = ref(false), playing = ref(false), cursor = ref(0), maximum = ref(0), speed = ref(1);
let stream: EventSource | null = null, timer: ReturnType<typeof setInterval> | undefined;
let generation = 0;
let timeline: TimelineEntry[] = [], playhead = 0;
const stageSpeech = ref<PublicEvent | null>(null);
const speechQueue: PublicEvent[] = [];
let speechUntil = 0;
const feedFilter = ref('all');
const setupOpen = ref(false);
const state = computed(() => view.value?.state);
const seats = computed<Standing[]>(() => state.value?.standings ?? config.value?.players?.map((agentId: string) => ({ agentId, score: 0, minorityWins: 0 })) ?? []);
const speaker = computed(() => stageSpeech.value ? String(stageSpeech.value.publicPayload.sender) : undefined);
const filteredEvents = computed(() => feedFilter.value === 'speech' ? events.value.filter(e => e.type === 'public_message') : events.value);
const roundProgress = computed(() => Array.from({ length: state.value?.rounds ?? config.value?.rounds ?? 10 }, (_, i) => i + 1));
function modelLabel(id: string) { return (state.value?.seatModels ?? config.value?.seatModels)?.[id]?.displayName ?? state.value?.model?.displayName ?? 'AI'; }
function clearSpeech() { stageSpeech.value = null; speechQueue.length = 0; speechUntil = 0; }
function announce(incoming: PublicEvent[], reset = false) {
  if (reset || state.value?.phase !== 'negotiation') clearSpeech();
  if (state.value?.phase !== 'negotiation') return;
  speechQueue.push(...publicSpeech(incoming, state.value.roundStartedMs ?? 0));
  tickSpeech();
}
function tickSpeech() {
  if (stageSpeech.value && Date.now() < speechUntil) return;
  stageSpeech.value = speechQueue.shift() ?? null;
  speechUntil = Date.now() + 6500;
}
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
function closeStream() { stream?.close(); stream = null; connected.value = false; generation++; clearSpeech(); }
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
      const seen = new Set(events.value.map(e => e.eventId)); const incoming = next.events.filter(e => !seen.has(e.eventId)); events.value.push(...incoming);
      view.value = next; maximum.value = next.lastSeq; connected.value = true;
      if (incoming.some(e => e.type === 'round_started' || e.type === 'phase_changed')) clearSpeech();
      announce(incoming);
    });
    stream.onerror = () => { connected.value = false; };
  } catch (e) { error.value = String(e); }
}
async function createSession() {
  try { error.value = ''; const created = await api('/api/sessions', config.value); await refreshList(); selected.value = created.id; setupOpen.value = false; await watchSession(); }
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
  const version = ++seekVersion; events.value = []; clearSpeech(); // Clear secret cache before any mode change/request.
  try {
    const next = await api(`/api/sessions/${selected.value}/replay?view=${god.value ? 'omniscient' : 'public'}&through=${cursor.value}`) as View;
    if (version !== seekVersion || !replayMode.value) return; view.value = next; events.value = next.events;
    const lastSpeech = publicSpeech(next.events, next.state.roundStartedMs ?? 0).at(-1);
    if (lastSpeech && lastSpeech.logicalTimeMs === next.state.logicalTimeMs) announce([lastSpeech], true);
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
  timer = setInterval(() => { tickSpeech(); if (playing.value && replayMode.value) { const next = advancePlayback(timeline, playhead, 250, speed.value); playhead = next.logicalTimeMs; if (next.cursor !== cursor.value) { cursor.value = next.cursor; void seek(true); } if (next.ended) playing.value = false; } }, 250);
});
onUnmounted(() => { closeStream(); clearInterval(timer); });
</script>

<template>
  <div class="shell">
    <header><a class="brand" href="/">MP<span>少數者密約<small>MINORITY PACT</small></span></a><div class="header-round"><span>第 <b>{{ String(state?.round ?? 1).padStart(2, '0') }}</b> / {{ state?.rounds ?? config?.rounds ?? 10 }} 回合</span><div class="round-dots" aria-hidden="true"><i v-for="r in roundProgress" :key="r" :class="{ past: r < (state?.round ?? 1), current: r === (state?.round ?? 1) }"></i></div></div><div class="signal"><i :class="{ online: connected }"></i>{{ replayMode ? '終局重播' : connected ? '即時觀戰' : '本機觀戰' }}</div></header>
    <main>
      <div v-if="error || view?.errorMessage" class="notice" role="alert">{{ error || view?.errorMessage }} <button v-if="error" @click="error = ''">關閉</button></div>
      <section class="toolbar"><label>對局 <select v-model="selected" @change="watchSession"><option value="">選擇對局</option><option v-for="id in ids" :key="id" :value="id">{{ id.slice(0, 12) }}</option></select></label><p class="table-motto">五個立場，兩種選擇。一位贏家。</p><div class="actions"><button v-if="selected" @click="watchSession">即時視角</button><button :disabled="!state || state.phase !== 'completed'" @click="enterReplay">終局重播 ↗</button><button :aria-expanded="setupOpen" aria-controls="session-setup" @click="setupOpen = !setupOpen">{{ setupOpen ? '收起設定' : '新對局 ＋' }}</button></div></section>
      <div class="dashboard">
        <section class="arena" aria-label="五席交涉牌桌">
          <div class="stage">
            <div class="stage-heading"><span class="eyebrow">THE NEGOTIATION ROOM</span><span>{{ replayMode ? (god ? '終局全知重播' : '公開重播') : '公開觀戰席' }}</span></div>
            <Transition name="speech"><div v-if="stageSpeech" :key="stageSpeech.eventId" class="speech-bubble"><span>{{ speaker }} 席 · 公開發言</span><p>{{ stageSpeech.publicPayload.body }}</p></div></Transition>
            <div v-if="!state" class="welcome"><p>真心，藏在選擇之後。</p><span>五席已就緒，建立對局即可開始觀戰。</span></div>
            <div class="table-surface" aria-hidden="true"><div class="table-inlay"></div></div>
            <div class="players">
              <PlayerSeat v-for="(s, i) in seats" :key="s.agentId" :standing="s" :portrait="['A','B','C','D','E'][i] ?? 'A'" :participant-label="modelLabel(s.agentId)" :expression="expressionFor(s.agentId, speaker, state?.phase, events)" :speaking="speaker === s.agentId" :vote="votes?.[s.agentId]" :reveal="Boolean(votes)" />
            </div>
            <div class="table-center"><span class="phase-caption">{{ state?.phase === 'completed' ? '本局結果' : state ? phases[state.phase] : '等待開局' }}</span><h1 v-if="state?.phase === 'completed'" class="outcome">{{ winner }}</h1><strong v-else class="table-clock">{{ state?.phase === 'negotiation' ? time(remaining) : '—:—' }}</strong><small>{{ state?.phase === 'negotiation' ? '交涉剩餘遊戲時間' : '選色統一揭曉 · 承諾不具強制力' }}</small></div>
            <div class="dialogue-strip"><b>{{ speaker ?? 'MP' }}</b><p>{{ stageSpeech?.publicPayload.body ?? (state?.phase === 'completed' ? '選擇已揭曉，回到紀錄尋找每一次轉折。' : state?.phase === 'commit' ? '交涉落幕。五席正在秘密選色，待統一揭曉。' : '聆聽每一個立場。沉默，也可能是一種選擇。') }}</p></div>
          </div>
          <div class="stage-footer"><div class="status-line" role="status"><i :class="{ online: connected }"></i>{{ statusLabel }}</div><div v-if="selected && !replayMode" class="controls"><button class="primary" :disabled="!hasKey || ['running','advancing','completed','aborted'].includes(view?.status ?? '')" @click="command(view?.status === 'idle' ? 'start' : 'resume')">{{ view?.status === 'idle' ? '開始對局' : '繼續對局' }}</button><button :disabled="!['running','advancing'].includes(view?.status ?? '')" @click="command('pause')">暫停</button><button class="quiet-button" :disabled="['completed','aborted'].includes(view?.status ?? '')" @click="command('abort')">中止</button></div><button v-if="!selected" class="primary" @click="setupOpen = true">設定新對局</button></div>
        </section>
        <section class="feed panel"><div class="section-top"><span class="eyebrow">CONVERSATION</span><span>{{ god && replayMode ? '上帝視角' : '限知視角' }}</span></div><h2>言語與暗流<span>{{ events.length }} 筆紀錄</span></h2><div class="journal-tabs" role="group" aria-label="對話篩選"><button :class="{ active: feedFilter === 'all' }" @click="feedFilter = 'all'">全部紀錄</button><button :class="{ active: feedFilter === 'speech' }" @click="feedFilter = 'speech'">公開對話</button></div><div class="event-list" tabindex="0" aria-label="對局事件紀錄"><p v-if="!filteredEvents.length" class="empty">尚無{{ feedFilter === 'speech' ? '公開對話' : '事件' }}。<br>沉默也可能是一種選擇。</p><article v-for="e in filteredEvents" :key="e.eventId" class="event" :class="{ private: e.type === 'private_message_sent', 'current-event': e.eventId === stageSpeech?.eventId }"><div class="event-meta"><b class="event-sender">{{ e.publicPayload.sender ?? e.publicPayload.actorId ?? 'MP' }}<template v-if="e.publicPayload.recipient"> → {{ e.publicPayload.recipient }}</template></b><time>{{ time(e.logicalTimeMs) }}</time><span>{{ e.type === 'private_message_sent' ? '私訊' : e.type === 'public_message' ? '公開' : '紀錄' }}</span></div><p>{{ describe(e) }}</p><details v-if="e.type === 'strategy_note'"><summary>查看原始備忘錄</summary><pre>{{ JSON.stringify(e.publicPayload.note, null, 2) }}</pre></details><small class="batch">#{{ e.commitSeq }}</small></article></div><div class="journal-footnote">{{ god && replayMode ? '終局重播 · 私訊與策略已解鎖' : '私訊內容與秘密選色，於終局重播解鎖。' }}</div></section>
      </div>
      <section v-if="replayMode" class="replay panel"><div class="section-top"><span class="eyebrow">REPLAY / 原始事件存檔</span><label><input v-model="god" type="checkbox" @change="seek()"> 解鎖私訊與策略</label></div><div class="replay-controls"><button @click="playing = !playing">{{ playing ? '暫停' : '播放' }}</button><input v-model.number="cursor" aria-label="重播事件位置" type="range" min="0" :max="maximum" @input="playing = false; seek()"><span>{{ cursor }} / {{ maximum }}</span><select v-model.number="speed" aria-label="播放速度"><option :value="1">1×</option><option :value="2">2×</option><option :value="5">5×</option><option :value="16">16×</option></select></div></section>
      <section v-if="config" v-show="setupOpen || !ids.length" id="session-setup" class="setup panel"><div class="section-top"><span class="eyebrow">NEXT SESSION</span><span>每席不同模型 · 規則一致</span></div><h2>下一場，由誰入席？</h2><div class="model-grid"><label v-for="id in config.players" :key="id">席位 {{ id }}<select v-model="config.seatModels[id].model" @change="config.seatModels[id].displayName = config.seatModels[id].model.split('/')[1]"><option v-if="!models.includes(config.seatModels[id].model)" :value="config.seatModels[id].model">{{ config.seatModels[id].displayName }}</option><option v-for="m in models" :key="m" :value="m">{{ m.split('/')[1] }}</option></select></label></div><div class="experiment-settings"><label>回合 <select v-model.number="config.rounds"><option :value="10">10</option><option :value="12">12</option></select></label><label>計分 <select :value="config.scoring.policy" @change="setScoring(($event.target as HTMLSelectElement).value)"><option value="exclusive">B · 獨占獎勵</option><option value="zero_sum">C · 零和轉移</option></select></label><label>同步方式 <select v-model="config.scheduling.mode"><option value="fixed_5s">5 秒窗口</option><option value="fixed_15s">15 秒窗口</option><option value="event_driven">事件驅動</option></select></label><label>交涉上限 <input v-model.number="config.negotiationTimeMs" type="number" min="1000" step="1000" aria-label="交涉上限毫秒"> ms</label></div><div class="setup-bottom"><span class="muted">設定只套用下一場，當局設定維持不變。<br><small v-if="!hasKey">尚未設定 OPENROUTER_API_KEY；仍可建立對局與查看歷史。</small></span><button class="primary" @click="createSession">建立新對局 ＋</button></div></section>
      <footer>MINORITY PACT <span>無劇本。無預設勝者。只保留當時發生的事。</span><span>LOCAL OBSERVATORY — V0.1</span></footer>
    </main>
  </div>
</template>
