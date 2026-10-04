export type PaymentFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * Período al que corresponde la tasa de interés.
 * 'total' = tasa fija sobre todo el préstamo (préstamos antiguos creados antes de este campo).
 */
export type InterestPeriod = 'annual' | 'monthly' | 'biweekly' | 'total';

/**
 * amortized     = Capital + interés: cada cuota incluye parte del capital y del interés.
 * interest_only = Solo interés: el cliente paga el interés cada período y abona al capital cuando desee.
 */
export type LoanType = 'amortized' | 'interest_only';

export interface Loan {
  id?: string;
  clientId: string;
  amount: number;
  interestRate: number; // Percentage
  interestPeriod?: InterestPeriod; // undefined en préstamos antiguos => 'total'
  loanType?: LoanType; // undefined en préstamos antiguos => 'amortized'
  duration: number; // Number of periods (solo aplica a 'amortized')
  paymentFrequency: PaymentFrequency;
  startDate: Date;
  status: 'active' | 'completed' | 'defaulted';
  installments?: Installment[];
  principalBalance?: number; // Capital pendiente (solo 'interest_only')
  capitalPayments?: CapitalPayment[]; // Historial de abonos a capital (solo 'interest_only')
}

export interface Installment {
  id?: string;
  loanId: string;
  dueDate: Date;
  amount: number; // Amount to pay in this installment
  paidAmount?: number; // Partial payment amount
  isPaid: boolean;
  paidDate?: Date;
  principalBase?: number; // Capital sobre el que se calculó el interés (solo 'interest_only')
}

export interface CapitalPayment {
  date: Date;
  amount: number;
  balanceAfter: number;
}
