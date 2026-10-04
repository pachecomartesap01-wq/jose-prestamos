export interface Loan {
  id?: string;
  clientId: string;
  amount: number;
  interestRate: number; // Percentage
  duration: number; // Number of periods
  paymentFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  startDate: Date;
  status: 'active' | 'completed' | 'defaulted';
  installments?: Installment[];
}

export interface Installment {
  id?: string;
  loanId: string;
  dueDate: Date;
  amount: number; // Amount to pay in this installment
  paidAmount?: number; // Partial payment amount
  isPaid: boolean;
  paidDate?: Date;
}
