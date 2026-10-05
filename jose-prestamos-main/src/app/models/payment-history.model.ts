export type PaymentHistoryType = 'installment' | 'capital' | 'reversal';
export type PaymentCollectorRole = 'admin' | 'cashier';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'other';

export interface PaymentActor {
  username: string;
  role: PaymentCollectorRole;
}

export interface PaymentHistoryEntry {
  id: string;
  loanId: string;
  clientId: string;
  clientName: string;
  installmentNumber?: number;
  loanAmount?: number;
  installmentAmount?: number;
  balanceRemaining?: number;
  amount: number;
  type: PaymentHistoryType;
  collectedBy: string;
  collectorRole: PaymentCollectorRole;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  collectedAt: Date;
}
