<script setup lang="ts">
import { ref, watch } from 'vue';
const props = defineProps<{ seat: string; players: string[]; pending: { snapshotId: string; phase: string; round: number; logicalTimeMs: number; windowIndex?: number; windowCount?: number; submitted: boolean } | null; ready: boolean; disabled: boolean }>();
const emit = defineEmits<{ submit: [value: unknown]; close: [] }>();
const publicMessage = ref(''), recipient = ref(''), privateMessage = ref(''), ready = ref(false), color = ref('');
const messages = ref<{ recipientId: string; message: string }[]>([]);
watch(() => props.pending?.snapshotId, () => { publicMessage.value = ''; privateMessage.value = ''; messages.value = []; color.value = ''; ready.value = props.ready; }, { immediate: true });
function addPrivate() { if (recipient.value && privateMessage.value.trim()) { messages.value.push({ recipientId: recipient.value, message: privateMessage.value.trim() }); privateMessage.value = ''; } }
function submit() {
  if (!props.pending || props.pending.submitted || props.disabled) return;
  if (props.pending.phase === 'commit') { if (color.value) emit('submit', { snapshotId: props.pending.snapshotId, color: color.value }); return; }
  const outgoing: { recipientId?: string; message: string }[] = [...messages.value];
  if (publicMessage.value.trim()) outgoing.unshift({ message: publicMessage.value.trim() });
  if (privateMessage.value.trim() && recipient.value) outgoing.push({ recipientId: recipient.value, message: privateMessage.value.trim() });
  emit('submit', { snapshotId: props.pending.snapshotId, messages: outgoing, ready: ready.value });
}
</script>

<template>
  <section class="human-panel panel" role="dialog" aria-label="你的行動">
    <div class="section-top"><strong>{{ seat }} 席 · 你</strong><button @click="emit('close')">收起</button></div>
    <p v-if="!pending">等待下一個行動窗口。已提交的內容會保留。</p>
    <template v-else>
      <h2>第 {{ pending.round }} 回合 · {{ pending.phase === 'commit' ? '秘密選色' : '本窗口行動' }}</h2>
      <p v-if="pending.phase === 'negotiation'">交涉窗口 {{ pending.windowIndex }}／{{ pending.windowCount }}</p>
      <p class="muted">不需趕時間。提交前可自由編輯；本批內容一起公布，彼此不預先參照。</p>
      <p v-if="pending.submitted" role="status">已提交並鎖定，等待本批完成。若對局出錯，請按「繼續對局」。</p>
      <form v-else @submit.prevent="submit">
        <fieldset :disabled="disabled">
          <template v-if="pending.phase === 'negotiation'">
            <label>公開發言<textarea v-model="publicMessage" aria-label="公開發言" maxlength="4000" rows="3" placeholder="留白表示不公開發言"></textarea></label>
            <label>私訊對象<select v-model="recipient" aria-label="私訊對象"><option value="">選擇席位</option><option v-for="id in players.filter(id => id !== seat)" :key="id" :value="id">{{ id }} 席</option></select></label>
            <label>私訊內容<textarea v-model="privateMessage" aria-label="私訊內容" maxlength="4000" rows="2"></textarea></label>
            <button type="button" :disabled="!recipient || !privateMessage.trim()" @click="addPrivate">加入待送私訊</button>
            <ul><li v-for="(m, i) in messages" :key="i">給 {{ m.recipientId }}：{{ m.message }} <button type="button" @click="messages.splice(i, 1)">移除</button></li></ul>
            <label class="ready-choice"><input v-model="ready" type="checkbox"> 我已準備投票（可在後續窗口撤回）</label>
            <button class="primary" type="submit" :disabled="Boolean(privateMessage.trim() && !recipient)">提交並推進</button>
            <p class="muted">沒有訊息也能提交，代表本批沉默。準備投票與推進窗口是不同選擇。</p>
          </template>
          <template v-else-if="pending.phase === 'commit'">
            <label><input v-model="color" type="radio" value="red" name="vote"> 紅色</label>
            <label><input v-model="color" type="radio" value="blue" name="vote"> 藍色</label>
            <p>確認後不能修改；五席完成後統一揭曉。</p>
            <button class="primary" type="submit" :disabled="!color">確認秘密選色</button>
          </template>
        </fieldset>
      </form>
    </template>
  </section>
</template>

<style scoped>
.human-panel { position: fixed; z-index: 30; right: 20px; bottom: 32px; width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 105px); overflow: auto; padding: 20px; border: 1px solid #b79b61; background: #12251f; box-shadow: 0 12px 60px #000b; }
h2 { margin: 12px 0; font-size: 20px; } fieldset { margin: 0; padding: 0; border: 0; } label { display: block; margin: 12px 0; } textarea { display: block; width: 100%; box-sizing: border-box; resize: vertical; background: #091a14; color: #f4e6c6; border: 1px solid #65775b; padding: 8px; font: inherit; } select { margin-left: 8px; } .muted { font-size: 12px; line-height: 1.6; } li { overflow-wrap: anywhere; margin: 8px 0; } input { width: auto; } .ready-choice { font-size: 13px; }
</style>
