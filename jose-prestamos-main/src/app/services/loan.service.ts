import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, deleteDoc, getDoc, query, where, getDocs, writeBatch, orderBy, onSnapshot } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Loan, Installment, InterestPeriod, PaymentFrequency } from '../models/loan.model';

@Injectable({
  providedIn: 'root'
})
export class LoanService {
  private collectionName = 'loans';

  constructor(private firestore: Firestore) {}

  async getLoanById(id: string): Promise<Loan | undefined> {
    const docRef = doc(this.firestore, this.collectionName, id);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() } as Loan;
    }
    return undefined;
  }

  getLoans(): Observable<Loan[]> {
    const loansRef = collection(this.firestore, this.collectionName);
    const q = query(loansRef, orderBy('startDate', 'desc'));
    
    return new Observable<Loan[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Loan[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  getLoansByClient(clientId: string): Observable<Loan[]> {
    const loansRef = collection(this.firestore, this.collectionName);
    const q = query(loansRef, where('clientId', '==', clientId));
    
    return new Observable<Loan[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Loan[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return () => unsubscribe();
    });
  }

  async updateLoan(id: string, data: Partial<Loan>): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return setDoc(docRef, data, { merge: true });
  }

  async deleteLoan(id: string): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return deleteDoc(docRef);
  }

  async createLoan(loan: Loan): Promise<string> {
    const loansRef = collection(this.firestore, this.collectionName);
    
    // Generate installments (si el formulario no las generó ya)
    if (!loan.installments) {
      loan.installments = this.calculateInstallments(loan);
    }
    
    const docRef = await addDoc(loansRef, loan);
    return docRef.id;
  }

  // ---------------------------------------------------------------------------
  // Cálculos de interés
  // ---------------------------------------------------------------------------

  /** Cantidad de períodos en un año (año comercial de 360 días para cobros diarios). */
  private static readonly PERIODS_PER_YEAR: Record<string, number> = {
    daily: 360,
    weekly: 52,
    biweekly: 24,
    monthly: 12,
    annual: 1
  };

  /** Convierte un Timestamp de Firebase / string / number a Date. */
  public toDate(value: any): Date {
    if (!value) return new Date(NaN);
    if (value instanceof Date) return value;
    if (typeof value.toDate === 'function') return value.toDate();
    return new Date(value);
  }

  public isLegacyRate(loan: Pick<Loan, 'interestPeriod'>): boolean {
    return !loan.interestPeriod || loan.interestPeriod === 'total';
  }

  public isInterestOnly(loan: Pick<Loan, 'loanType'>): boolean {
    return loan.loanType === 'interest_only';
  }

  /**
   * Tasa (en decimal) que corresponde a UNA cuota, convirtiendo proporcionalmente
   * el período de la tasa a la frecuencia de pago.
   * Ej: 10% mensual cobrado quincenal => 0.05 por cuota.
   */
  public ratePerPayment(rate: number, interestPeriod: InterestPeriod | undefined, frequency: PaymentFrequency): number {
    if (!interestPeriod || interestPeriod === 'total') return 0;
    const ppyRate = LoanService.PERIODS_PER_YEAR[interestPeriod];
    const ppyPayment = LoanService.PERIODS_PER_YEAR[frequency];
    return (rate / 100) * (ppyRate / ppyPayment);
  }

  /** Suma n períodos a la fecha de inicio (en mensual respeta el fin de mes). */
  public addPeriods(start: Date, n: number, frequency: PaymentFrequency): Date {
    const d = new Date(start);
    if (frequency === 'daily') {
      d.setDate(d.getDate() + n);
    } else if (frequency === 'weekly') {
      d.setDate(d.getDate() + 7 * n);
    } else if (frequency === 'biweekly') {
      d.setDate(d.getDate() + 15 * n);
    } else if (frequency === 'monthly') {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, lastDay));
    }
    return d;
  }

  /** Interés total de un préstamo Capital + Interés (interés fijo sobre el monto original). */
  public amortizedTotalInterest(loan: Pick<Loan, 'amount' | 'interestRate' | 'interestPeriod' | 'duration' | 'paymentFrequency'>): number {
    if (this.isLegacyRate(loan)) {
      return loan.amount * (loan.interestRate / 100);
    }
    return loan.amount * this.ratePerPayment(loan.interestRate, loan.interestPeriod, loan.paymentFrequency) * loan.duration;
  }

  /** Interés de una cuota para un préstamo de Solo Interés, dado el capital pendiente. */
  public interestOnlyPayment(balance: number, loan: Pick<Loan, 'interestRate' | 'interestPeriod' | 'paymentFrequency'>): number {
    const value = balance * this.ratePerPayment(loan.interestRate, loan.interestPeriod, loan.paymentFrequency);
    return Math.round(value * 100) / 100;
  }

  public calculateInstallments(loan: Loan): Installment[] {
    if (this.isInterestOnly(loan)) {
      return this.syncInterestOnlyInstallments({ ...loan, installments: [], principalBalance: loan.amount });
    }

    const installments: Installment[] = [];
    // Simple Interest Calculation
    const totalInterest = this.amortizedTotalInterest(loan);
    const totalAmount = loan.amount + totalInterest;
    const amountPerInstallment = totalAmount / loan.duration;
    const start = this.toDate(loan.startDate);
    
    for (let i = 1; i <= loan.duration; i++) {
      installments.push({
        loanId: '', // Will be assigned later if storing in subcollection, but here it's embedded
        dueDate: this.addPeriods(start, i, loan.paymentFrequency),
        amount: amountPerInstallment,
        isPaid: false
      });
    }
    
    return installments;
  }

  /**
   * Préstamos de Solo Interés (abiertos): genera las cuotas de interés vencidas hasta hoy
   * y siempre deja una próxima cuota pendiente, mientras quede capital por pagar.
   * Cada cuota nueva se calcula sobre el capital pendiente en ese momento.
   */
  public syncInterestOnlyInstallments(loan: Loan, asOf: Date = new Date()): Installment[] {
    const list: Installment[] = [...(loan.installments || [])];
    const balance = loan.principalBalance ?? loan.amount;
    if (balance <= 0 || loan.status !== 'active') return list;

    const today = new Date(asOf);
    today.setHours(0, 0, 0, 0);
    const start = this.toDate(loan.startDate);
    const amount = this.interestOnlyPayment(balance, loan);

    let guard = 0;
    while (
      guard++ < 2000 &&
      (list.length === 0 || this.toDate(list[list.length - 1].dueDate) < today)
    ) {
      list.push({
        loanId: '',
        dueDate: this.addPeriods(start, list.length + 1, loan.paymentFrequency),
        amount,
        isPaid: false,
        principalBase: balance
      });
    }
    return list;
  }

  /** Interés total esperado (para estadísticas del dashboard). */
  public expectedInterest(loan: Loan): number {
    if (this.isInterestOnly(loan)) {
      return (loan.installments || []).reduce((sum, inst) => sum + inst.amount, 0);
    }
    return this.amortizedTotalInterest(loan);
  }

  /** Determina si el préstamo queda activo o completado después de un pago. */
  public resolveStatus(loan: Loan, installments: Installment[], balance?: number): Loan['status'] {
    if (loan.status === 'defaulted') return loan.status;
    const allPaid = installments.length > 0 && installments.every(i => i.isPaid);
    if (this.isInterestOnly(loan)) {
      const pending = balance ?? loan.principalBalance ?? loan.amount;
      return allPaid && pending <= 0 ? 'completed' : 'active';
    }
    return allPaid ? 'completed' : 'active';
  }

  public frequencyLabel(freq: PaymentFrequency): string {
    return { daily: 'Diario', weekly: 'Semanal', biweekly: 'Quincenal', monthly: 'Mensual' }[freq] || freq;
  }

  public interestPeriodLabel(period?: InterestPeriod): string {
    if (!period || period === 'total') return 'sobre el total';
    return { annual: 'anual', monthly: 'mensual', biweekly: 'quincenal' }[period];
  }
}
