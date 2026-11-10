export const PAYMENT_CONDITIONS = ['recipient_red', 'recipient_blue', 'same_color', 'different_color', 'payer_minority'] as const;
export type PaymentCondition = typeof PAYMENT_CONDITIONS[number];
export interface PaymentContract {
  id: string; round: number; payer: string; recipient: string; amount: number; condition: PaymentCondition;
  status: 'proposed' | 'active' | 'cancelled'; cancelApprovals: string[];
}
export const paymentLabels: Record<PaymentCondition, string> = {
  recipient_red: '收款人投紅', recipient_blue: '收款人投藍', same_color: '雙方同色',
  different_color: '雙方異色', payer_minority: '付款人取得少數方獎金',
};
