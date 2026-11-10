<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RoundResult } from '../presentation.ts';
const props = defineProps<{ results: RoundResult[]; players: string[]; scoring?: { solo: number; pair: number; majority: number } }>();
const expanded = ref(false);
const latest = computed(() => props.results.at(-1));
const visible = computed(() => [...(expanded.value ? props.results : props.results.slice(-3))].reverse());
const signed = (n: number) => n > 0 ? `+${n}` : `${n}`;
function award(r: RoundResult, id: string) {
  if (!props.scoring) return '—';
  if (!r.reds || !r.blues) return '0';
  return signed(r.minority.includes(id) ? r.minority.length === 1 ? props.scoring.solo : props.scoring.pair : props.scoring.majority);
}
</script>
<template>
  <section class="round-results" aria-label="歷史投票結果">
    <h3>投票結果 <small v-if="latest">最近揭曉：第 {{ latest.round }} 回合</small></h3>
    <p v-if="!latest" class="result-empty">尚無已揭曉結果；本輪選色仍保密。</p>
    <template v-else>
      <p class="result-summary"><b>紅 {{ latest.reds }}：藍 {{ latest.blues }}</b><span>{{ latest.minority.length ? `少數方 ${latest.minority.join('、')}` : '無少數方' }}</span></p>
      <div class="results-scroll">
        <table><caption>選色／選色獎金／結算淨增減</caption><thead><tr><th scope="col">回合</th><th v-for="id in players" :key="id" scope="col">{{ id }}</th></tr></thead>
          <tbody><tr v-for="r in visible" :key="r.round" :data-result-round="r.round"><th scope="row">{{ r.round }}</th><td v-for="id in players" :key="id" :class="{ minority: r.minority.includes(id) }"><b :class="r.votes[id]">{{ r.votes[id] === 'red' ? '紅' : '藍' }}</b><small>獎 {{ award(r, id) }}</small><small>淨 {{ r.settled ? signed(r.net[id] ?? 0) : '待結算' }}</small></td></tr></tbody>
        </table>
      </div>
      <button v-if="results.length > 3" type="button" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起，只看最近三輪' : `查看全部 ${results.length} 輪` }}</button>
      <p class="result-note">淨增減包含契約付款；契約內容仍依觀看權限保密。</p>
    </template>
  </section>
</template>
<style scoped>
.round-results { flex: 0 0 auto; min-height: 0; padding: 10px 18px; border-bottom: 1px solid #b79b6140; background: #0c1d17; }
h3 { margin: 0; font-size: 15px; } h3 small { font-size: 10px; margin-left: 8px; color: #d1c5aa; font-weight: normal; }
.result-summary { display: flex; gap: 16px; margin: 8px 0; font-size: 12px; flex-wrap: wrap; }
.results-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: center; }
caption { text-align: left; font-size: 10px; padding-bottom: 5px; color: #d1c5aa; } th, td { padding: 5px 3px; border-bottom: 1px solid #b79b6120; } td small { display: block; font-size: 9px; line-height: 1.4; }
.red { color: #ff9393; } .blue { color: #91c8ff; } .minority { background: #b79b6118; } .minority b::after { content: ' ★'; font-size: 8px; color: #e8cf92; }
.result-note, .result-empty { margin: 6px 0 0; font-size: 10px; line-height: 1.5; color: #d1c5aa; } button { margin-top: 6px; padding: 4px 8px; font-size: 10px; }
@media (max-height: 850px) and (min-width: 951px) { .round-results { padding: 7px 12px; } }
</style>
