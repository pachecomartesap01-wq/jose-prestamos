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
export type InterestMethod = 'flat' | 'reducing_balance';

export interface Loan {
  id?: string;
  clientId: string;
  amount: number;
  interestRate: number; // Percentage
  interestPeriod?: InterestPeriod; // undefined en préstamos antiguos => 'total'
  interestMethod?: InterestMethod; // undefined en préstamos existentes => cálculo fijo original
  loanType?: LoanType; // undefined en préstamos antiguos => 'amortized'
  duration: number; // Number of periods (solo aplica a 'amortized')
  paymentFrequency: PaymentFrequency;
  startDate: Date;
  status: 'active' | 'completed' | 'defaulted';
  installments?: Installment[];
  principalBalance?: number; // Capital pendiente (solo 'interest_only')
  capitalPayments?: CapitalPayment[]; // Historial de abonos extraordinarios a capital
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
  principalAmount?: number;
  interestAmount?: number;
  paidPrincipalAmount?: number;
  paidInterestAmount?: number;
}

export interface CapitalPayment {
  date: Date;
  amount: number;
  balanceAfter?: number;
}
