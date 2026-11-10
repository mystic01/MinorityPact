import type { PaymentContract } from '../contracts/payment.ts';
import type { Color, Standing } from '../contracts/public.ts';

// Server-only settlement policy. Do not include this function or its policy in agent rules.
export function settlePayments(contracts: PaymentContract[], votes: Record<string, Color>, standings: Standing[], awards: Standing[]) {
  const triggered = contracts.filter(c => c.status === 'active' && (
    c.condition === 'recipient_red' ? votes[c.recipient] === 'red' :
    c.condition === 'recipient_blue' ? votes[c.recipient] === 'blue' :
    c.condition === 'same_color' ? votes[c.payer] === votes[c.recipient] :
    c.condition === 'different_color' ? votes[c.payer] !== votes[c.recipient] :
    awards.some(a => a.agentId === c.payer && a.minorityWins > 0 && a.score > 0)));
  const totals = new Map<string, bigint>();
  for (const c of triggered) totals.set(c.payer, (totals.get(c.payer) ?? 0n) + BigInt(c.amount));
  return contracts.filter(c => c.status === 'active').map(contract => {
    const met = triggered.includes(contract);
    const available = BigInt(standings.find(s => s.agentId === contract.payer)!.score) + BigInt(awards.find(s => s.agentId === contract.payer)!.score);
    const failed = met && (totals.get(contract.payer) ?? 0n) > available;
    return { contract, paid: met && !failed ? contract.amount : 0,
      reason: !met ? '條件未觸發' : failed ? '付款人支付能力不足' : '付款完成' };
  });
}
