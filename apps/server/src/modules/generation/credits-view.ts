/** 返回给参展商的任务积分视图：预占、冻结、实扣与释放金额 */
export type GenerationCreditStatus = 'not_charged' | 'reserved' | 'settling' | 'settled' | 'released';

export interface GenerationCredits {
  status: GenerationCreditStatus;
  reservedCredits: number;
  heldCredits: number;
  chargedCredits: number;
  releasedCredits: number;
}
