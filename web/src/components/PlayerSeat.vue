<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Standing } from '../../../src/contracts/public.ts';
import type { Expression } from '../presentation.ts';

// The seat accepts a participant label independently of its portrait or controller.
// A future human controller can use this presentation without changing the stage.
const props = defineProps<{ standing: Standing; portrait: string; participantLabel: string; expression: Expression; speaking: boolean; vote?: string; reveal: boolean; phase?: string; previousVote?: string; previousRound?: number }>();
const broken = ref(false);
const source = computed(() => `/avatars/${props.portrait}/${props.expression}.png`);
watch(source, () => { broken.value = false; });
</script>

<template>
  <article class="player-seat" :class="{ speaking }" :aria-label="`${standing.agentId} 席，${participantLabel}，${standing.score} 分`">
    <div class="portrait-wrap">
      <div v-if="broken" class="portrait-fallback" aria-label="頭像暫時無法載入">{{ standing.agentId }}</div>
      <img v-else class="portrait" :src="source" :alt="`${standing.agentId} 席人物頭像`" :data-expression="expression" @error="broken = true" draggable="false">
      <span v-if="speaking" class="speaking-tag">正在閱讀</span>
    </div>
    <div class="nameplate">
      <div class="identity"><b class="seat-letter">{{ standing.agentId }}</b><span class="participant-label" :title="participantLabel">{{ participantLabel }}</span></div>
      <div class="seat-score"><span>得分 <strong>{{ standing.score }}</strong></span><small>少數勝 {{ standing.minorityWins }}</small></div>
    </div>
    <div class="choice-display">
      <div class="choice-token" :class="reveal && vote ? vote : ''" :aria-label="reveal && vote ? `本輪已揭曉：${vote === 'red' ? '紅色' : '藍色'}` : '本輪選色尚未揭曉，不表示已提交'">
        <span v-if="reveal && vote">{{ vote === 'red' ? '紅' : '藍' }}</span><span v-else class="sealed-label">{{ phase === 'commit' ? '未揭曉' : '本輪待投' }}</span>
      </div>
      <small v-if="previousVote" class="previous-choice" :class="previousVote">上輪 R{{ previousRound }}：{{ previousVote === 'red' ? '紅' : '藍' }}</small>
    </div>
  </article>
</template>

<style scoped>
.choice-display { display: flex; justify-content: center; align-items: center; gap: 5px; min-width: 0; }
.choice-display .choice-token { flex: 0 0 auto; width: auto; min-width: 36px; padding: 0 4px; }
.sealed-label { font-size: 9px; white-space: nowrap; } .previous-choice { font-size: 9px; white-space: nowrap; }
.previous-choice.red { color: #ffaaaa; } .previous-choice.blue { color: #a0d0ff; }
</style>
