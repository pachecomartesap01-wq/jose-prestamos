import { Injectable } from '@angular/core';
import { Firestore, collection, doc, setDoc, addDoc, getDoc, query, where, getDocs, getDocsFromServer, orderBy, limit, startAfter, QueryDocumentSnapshot, DocumentData, writeBatch, onSnapshot, runTransaction, serverTimestamp } from '@angular/fire/firestore';
import { map, Observable, shareReplay } from 'rxjs';
import { Loan, Installment, InterestPeriod, PaymentFrequency } from '../models/loan.model';
import { PaymentActor, PaymentHistoryEntry, PaymentHistoryType, PaymentMethod } from '../models/payment-history.model';
import { CollectionSnapshot } from '../models/collection-snapshot.model';

@Injectable({
  providedIn: 'root'
})
export class LoanService {
  private collectionName = 'loans';
  private paymentHistoryCollectionName = 'paymentHistory';
  private loansSnapshot$?: Observable<CollectionSnapshot<Loan & { id: string }>>;
  private paymentHistory$?: Observable<PaymentHistoryEntry[]>;

  constructor(private firestore: Firestore) {}

  async getLoanById(id: string): Promise<Loan | undefined> {
    const docRef = doc(this.firestore, this.collectionName, id);
    const snapshot = await getDoc(docRef);
    if (snapshot.exists()) {
      return { id: snapshot.id, ...snapshot.data() } as Loan;
    }
    return undefined;
  }

  getLoans(): Observable<Array<Loan & { id: string }>> {
    return this.getLoansSnapshot().pipe(map(snapshot => snapshot.data));
  }

  getLoansSnapshot(): Observable<CollectionSnapshot<Loan & { id: string }>> {
    if (this.loansSnapshot$) return this.loansSnapshot$;

    const loansRef = collection(this.firestore, this.collectionName);
    this.loansSnapshot$ = new Observable<CollectionSnapshot<Loan & { id: string }>>(observer => {
      const unsubscribe = onSnapshot(loansRef, { includeMetadataChanges: true }, snapshot => {
        const data = snapshot.docs
          .map(d => ({ ...d.data(), id: d.id }) as Loan & { id: string })
          .sort((a, b) => {
            const startA = this.toDate(a.startDate).getTime();
            const startB = this.toDate(b.startDate).getTime();
            const byDate = (Number.isFinite(startB) ? startB : 0) -
              (Number.isFinite(startA) ? startA : 0);
            return byDate || String(a.id).localeCompare(String(b.id));
          });
        observer.next({
          data,
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites
        });
      }, error => observer.error(error));
      return unsubscribe;
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    return this.loansSnapshot$;
  }

  getLoansByClient(clientId: string): Observable<Loan[]> {
    const loansRef = collection(this.firestore, this.collectionName);
    const q = query(loansRef, where('clientId', '==', clientId));

    return new Observable<Loan[]>(observer => {
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(d => ({ ...d.data(), id: d.id })) as Loan[];
        observer.next(data);
      }, error => {
        observer.error(error);
      });
      return unsubscribe;
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));
  }

  getPaymentHistory(): Observable<PaymentHistoryEntry[]> {
    if (this.paymentHistory$) return this.paymentHistory$;

    const historyRef = collection(this.firestore, this.paymentHistoryCollectionName);
    const recentHistoryQuery = query(historyRef, orderBy('collectedAt', 'desc'), limit(50));
    this.paymentHistory$ = new Observable<PaymentHistoryEntry[]>(observer => {
      const unsubscribe = onSnapshot(recentHistoryQuery, snapshot => {
        const entries = snapshot.docs.map(entry =>
          this.toPaymentHistoryEntry(entry.id, entry.data())
        );
        observer.next(entries);
      }, error => observer.error(error));
      return unsubscribe;
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    return this.paymentHistory$;
  }

  async getPaymentHistoryPage(
    cursor?: QueryDocumentSnapshot<DocumentData>
  ): Promise<{ entries: PaymentHistoryEntry[]; cursor?: QueryDocumentSnapshot<DocumentData>; hasMore: boolean }> {
    const historyRef = collection(this.firestore, this.paymentHistoryCollectionName);
    const constraints = [orderBy('collectedAt', 'desc'), ...(cursor ? [startAfter(cursor)] : []), limit(50)];
    const pageQuery = query(historyRef, ...constraints);
    const snapshot = await getDocsFromServer(pageQuery);
    const lastDocument = snapshot.docs[snapshot.docs.length - 1];
    return {
      entries: snapshot.docs.map(entry => this.toPaymentHistoryEntry(entry.id, entry.data())),
      cursor: lastDocument,
      hasMore: snapshot.docs.length === 50
    };
  }

  private toPaymentHistoryEntry(id: string, data: DocumentData): PaymentHistoryEntry {
    return {
      ...data,
      id,
      collectedAt: this.toDate(data['collectedAt'])
    } as PaymentHistoryEntry;
  }

  async updateLoan(id: string, data: Partial<Loan>): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    return setDoc(docRef, data, { merge: true });
  }

  async collectInstallment(
    loanId: string,
    installmentIndex: number,
    amount: number,
    actor: PaymentActor,
    clientName: string,
    paymentMethod: PaymentMethod = 'cash'
  ): Promise<PaymentHistoryEntry> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El monto del cobro debe ser mayor que cero.');
    }

    const loanRef = doc(this.firestore, this.collectionName, loanId);
    const historyRef = doc(collection(this.firestore, this.paymentHistoryCollectionName));
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(loanRef);
      if (!snapshot.exists()) throw new Error('El préstamo ya no existe.');

      const loan = { id: snapshot.id, ...snapshot.data() } as Loan;
      const installments = (loan.installments || []).map(installment => ({ ...installment }));
      const installment = installments[installmentIndex];
      if (!installment) throw new Error('La cuota seleccionada ya no existe.');
      if (installment.isPaid) throw new Error('Esta cuota ya fue pagada.');

      const remaining = Math.round((installment.amount - (installment.paidAmount || 0)) * 100) / 100;
      const payment = Math.round(amount * 100) / 100;
      if (payment > remaining) {
        throw new Error(`El cobro no puede superar el saldo pendiente de $${remaining.toFixed(2)}.`);
      }

      const totalPaid = Math.round(((installment.paidAmount || 0) + payment) * 100) / 100;
      installment.paidAmount = totalPaid;
      if (loan.interestMethod === 'reducing_balance') {
        const paidInterestAmount = Math.min(totalPaid, installment.interestAmount || 0);
        installment.paidInterestAmount = paidInterestAmount;
        installment.paidPrincipalAmount = Math.min(
          installment.principalAmount || 0,
          Math.max(0, totalPaid - paidInterestAmount)
        );
      }
      installment.isPaid = totalPaid >= installment.amount;
      if (installment.isPaid) installment.paidDate = new Date();

      transaction.update(loanRef, {
        installments,
        status: this.resolveStatus(loan, installments)
      });
      const collectedAt = new Date();
      const historyEntry = this.createPaymentHistoryEntry(
        historyRef.id,
        loan,
        clientName,
        installmentIndex + 1,
        payment,
        'installment',
        actor,
        {
          loanAmount: loan.amount,
          installmentAmount: installment.amount,
          balanceRemaining: Math.max(0, Math.round((installment.amount - totalPaid) * 100) / 100),
          paymentMethod
        }
      );
      transaction.set(historyRef, {
        ...historyEntry,
        collectedAt: serverTimestamp()
      });
      return { ...historyEntry, collectedAt };
    });
  }

  async reverseInstallment(loanId: string, installmentIndex: number, actor: PaymentActor, clientName: string): Promise<void> {
    const loanRef = doc(this.firestore, this.collectionName, loanId);
    const historyRef = doc(collection(this.firestore, this.paymentHistoryCollectionName));

    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(loanRef);
      if (!snapshot.exists()) throw new Error('El préstamo ya no existe.');

      const loan = { id: snapshot.id, ...snapshot.data() } as Loan;
      const installments = (loan.installments || []).map(installment => ({ ...installment }));
      const installment = installments[installmentIndex];
      if (!installment?.isPaid) throw new Error('La cuota ya no figura como pagada.');

      const amount = installment.paidAmount || installment.amount;
      installment.isPaid = false;
      installment.paidAmount = 0;
      delete installment.paidDate;
      delete installment.paidInterestAmount;
      delete installment.paidPrincipalAmount;

      transaction.update(loanRef, {
        installments,
        status: this.resolveStatus(loan, installments)
      });
      transaction.set(historyRef, {
        ...this.createPaymentHistoryEntry(
          historyRef.id,
          loan,
          clientName,
          installmentIndex + 1,
          amount,
          'reversal',
          actor
        ),
        collectedAt: serverTimestamp()
      });
    });
  }

  async collectAmortizedCapital(
    loanId: string,
    amount: number,
    actor: PaymentActor,
    clientName: string,
    paymentMethod: PaymentMethod = 'cash'
  ): Promise<PaymentHistoryEntry> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El monto del abono debe ser mayor que cero.');
    }

    const loanRef = doc(this.firestore, this.collectionName, loanId);
    const historyRef = doc(collection(this.firestore, this.paymentHistoryCollectionName));
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(loanRef);
      if (!snapshot.exists()) throw new Error('El préstamo ya no existe.');

      const loan = { id: snapshot.id, ...snapshot.data() } as Loan;
      const installments = (loan.installments || []).map(installment => ({ ...installment }));
      const unpaidIndices = installments
        .map((installment, index) => ({ installment, index }))
        .filter(item => !item.installment.isPaid);
      if (unpaidIndices.length === 0) throw new Error('No hay cuotas pendientes para abonar a capital.');

      const totalPending = unpaidIndices.reduce((sum, item) =>
        sum + item.installment.amount - (item.installment.paidAmount || 0), 0);
      const payment = Math.round(amount * 100) / 100;
      if (loan.interestMethod === 'reducing_balance') {
        const outstandingPrincipal = this.amortizedOutstandingPrincipal(loan);
        if (payment >= outstandingPrincipal) {
          throw new Error('El abono a capital debe ser menor al capital pendiente. Solicita una liquidación para saldar el préstamo.');
        }
        const recast = this.reducingBalanceAmounts({
          amount: outstandingPrincipal - payment,
          interestRate: loan.interestRate,
          interestPeriod: loan.interestPeriod,
          duration: unpaidIndices.length,
          paymentFrequency: loan.paymentFrequency
        });
        unpaidIndices.forEach(({ installment }, index) => {
          const next = recast[index];
          installment.amount = next.amount;
          installment.paidAmount = 0;
          delete installment.paidDate;
          delete installment.paidInterestAmount;
          delete installment.paidPrincipalAmount;
          installment.isPaid = false;
          installment.principalAmount = next.principalAmount;
          installment.interestAmount = next.interestAmount;
        });
      } else {
        if (payment >= totalPending) {
          throw new Error('El abono debe ser menor al total pendiente. Usa el cobro de cuotas para saldar el préstamo.');
        }
        const deduction = payment / unpaidIndices.length;
        for (const { installment } of unpaidIndices) {
          installment.amount = Math.max(installment.paidAmount || 0, installment.amount - deduction);
          if (installment.paidAmount && installment.paidAmount >= installment.amount) {
            installment.isPaid = true;
            installment.paidDate = new Date();
            installment.paidAmount = installment.amount;
          }
        }
      }

      const capitalPayments = [
        ...(loan.capitalPayments || []),
        {
          date: new Date(),
          amount: payment
        }
      ];
      transaction.update(loanRef, {
        installments,
        capitalPayments,
        status: this.resolveStatus(loan, installments)
      });
      const collectedAt = new Date();
      const historyEntry = this.createPaymentHistoryEntry(
        historyRef.id, loan, clientName, undefined, payment, 'capital', actor,
        { loanAmount: loan.amount, paymentMethod }
      );
      transaction.set(historyRef, {
        ...historyEntry,
        collectedAt: serverTimestamp()
      });
      return { ...historyEntry, collectedAt };
    });
  }

  async collectInterestOnlyCapital(
    loanId: string,
    amount: number,
    actor: PaymentActor,
    clientName: string,
    paymentMethod: PaymentMethod = 'cash'
  ): Promise<{ balance: number; status: Loan['status']; loan: Loan; receipt: PaymentHistoryEntry }> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El monto del abono debe ser mayor que cero.');
    }

    const loanRef = doc(this.firestore, this.collectionName, loanId);
    const historyRef = doc(collection(this.firestore, this.paymentHistoryCollectionName));
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(loanRef);
      if (!snapshot.exists()) throw new Error('El préstamo ya no existe.');

      const loan = { id: snapshot.id, ...snapshot.data() } as Loan;
      const balance = loan.principalBalance ?? loan.amount;
      const paymentAmount = Math.round(amount * 100) / 100;
      if (paymentAmount > balance) {
        throw new Error(`El abono no puede superar el capital pendiente ($${balance.toFixed(2)}).`);
      }

      const newBalance = Math.max(0, Math.round((balance - paymentAmount) * 100) / 100);
      const capitalPayments = [
        ...(loan.capitalPayments || []),
        { date: new Date(), amount: paymentAmount, balanceAfter: newBalance }
      ];
      const installments = loan.installments || [];
      const status = this.resolveStatus(loan, installments, newBalance);

      transaction.update(loanRef, { principalBalance: newBalance, capitalPayments, status });
      const collectedAt = new Date();
      const receipt = this.createPaymentHistoryEntry(
        historyRef.id, loan, clientName, undefined, paymentAmount, 'capital', actor,
        { loanAmount: loan.amount, balanceRemaining: newBalance, paymentMethod }
      );
      transaction.set(historyRef, {
        ...receipt,
        collectedAt: serverTimestamp()
      });
      return { balance: newBalance, status, loan, receipt: { ...receipt, collectedAt } };
    });
  }

  private createPaymentHistoryEntry(
    id: string,
    loan: Loan,
    clientName: string,
    installmentNumber: number | undefined,
    amount: number,
    type: PaymentHistoryType,
    actor: PaymentActor,
    details: Partial<PaymentHistoryEntry> = {}
  ): PaymentHistoryEntry {
    return {
      id,
      loanId: loan.id || '',
      clientId: loan.clientId,
      clientName: clientName || 'Cliente desconocido',
      installmentNumber,
      amount,
      type,
      collectedBy: actor.username,
      collectorRole: actor.role,
      collectedAt: new Date(),
      ...details
    };
  }

  async deleteLoan(id: string): Promise<void> {
    const docRef = doc(this.firestore, this.collectionName, id);
    const historyRef = collection(this.firestore, this.paymentHistoryCollectionName);
    const history = await getDocsFromServer(query(historyRef, where('loanId', '==', id)));
    if (!history.empty) {
      throw new Error('Este préstamo tiene movimientos en el historial de cobros y no se puede eliminar.');
    }
    await runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists()) return;

      const loan = snapshot.data() as Loan;
      const hasRecordedInstallmentPayment = (loan.installments || []).some(installment =>
        installment.isPaid || (installment.paidAmount || 0) > 0
      );
      if (
        loan.status !== 'active' ||
        hasRecordedInstallmentPayment ||
        (loan.capitalPayments?.length ?? 0) > 0
      ) {
        throw new Error('No se puede eliminar un préstamo con pagos o movimientos. Conserva el expediente para mantener su historial financiero.');
      }

      transaction.delete(docRef);
    });
  }

  async hasPaymentHistoryForLoan(id: string): Promise<boolean> {
    const historyRef = collection(this.firestore, this.paymentHistoryCollectionName);
    const history = await getDocsFromServer(query(historyRef, where('loanId', '==', id)));
    return !history.empty;
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
  public toDate(value: unknown): Date {
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === 'string' || typeof value === 'number') return new Date(value);
    if (typeof value !== 'object' || value === null) return new Date(NaN);

    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return date instanceof Date ? new Date(date.getTime()) : new Date(NaN);
    }

    const seconds = timestamp.seconds ?? timestamp._seconds;
    const nanoseconds = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
    if (typeof seconds === 'number' && Number.isFinite(seconds) &&
        typeof nanoseconds === 'number' && Number.isFinite(nanoseconds)) {
      return new Date(seconds * 1000 + nanoseconds / 1_000_000);
    }
    return new Date(NaN);
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
  public amortizedTotalInterest(
    loan: Pick<Loan, 'amount' | 'interestRate' | 'interestPeriod' | 'duration' | 'paymentFrequency'> &
      Partial<Pick<Loan, 'interestMethod'>>
  ): number {
    if (loan.interestMethod === 'reducing_balance') {
      return this.reducingBalanceAmounts(loan).reduce((total, installment) => total + installment.interestAmount, 0);
    }
    if (this.isLegacyRate(loan)) {
      return loan.amount * (loan.interestRate / 100);
    }
    return loan.amount * this.ratePerPayment(loan.interestRate, loan.interestPeriod, loan.paymentFrequency) * loan.duration;
  }

  private reducingBalanceAmounts(
    loan: Pick<Loan, 'amount' | 'interestRate' | 'interestPeriod' | 'duration' | 'paymentFrequency'>
  ): Array<{ amount: number; principalAmount: number; interestAmount: number }> {
    const periods = Math.floor(loan.duration);
    if (!Number.isFinite(loan.amount) || loan.amount <= 0 || periods <= 0) return [];

    const rate = this.ratePerPayment(loan.interestRate, loan.interestPeriod, loan.paymentFrequency);
    const principalCents = Math.round(loan.amount * 100);
    const regularPaymentCents = rate === 0
      ? Math.round(principalCents / periods)
      : Math.round((principalCents * rate / (1 - Math.pow(1 + rate, -periods))));
    let balanceCents = principalCents;

    return Array.from({ length: periods }, (_, index) => {
      const interestCents = Math.round(balanceCents * rate);
      const paymentCents = index === periods - 1
        ? balanceCents + interestCents
        : Math.max(interestCents + 1, regularPaymentCents);
      const principalPaymentCents = Math.min(balanceCents, paymentCents - interestCents);
      balanceCents = Math.max(0, balanceCents - principalPaymentCents);
      const amountCents = principalPaymentCents + interestCents;
      return {
        amount: amountCents / 100,
        principalAmount: principalPaymentCents / 100,
        interestAmount: interestCents / 100
      };
    });
  }

  public amortizedOutstandingPrincipal(loan: Loan): number {
    if (loan.interestMethod !== 'reducing_balance') {
      return (loan.installments || []).reduce((total, installment) =>
        installment.isPaid ? total : total + installment.amount - (installment.paidAmount || 0), 0);
    }
    return (loan.installments || []).reduce((total, installment) => {
      if (installment.isPaid) return total;
      const paidPrincipal = installment.paidPrincipalAmount ??
        Math.max(0, (installment.paidAmount || 0) - (installment.interestAmount || 0));
      return total + Math.max(0, (installment.principalAmount || 0) - paidPrincipal);
    }, 0);
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

    if (loan.interestMethod === 'reducing_balance') {
      const start = this.toDate(loan.startDate);
      return this.reducingBalanceAmounts(loan).map((amounts, index) => ({
        loanId: '',
        dueDate: this.addPeriods(start, index + 1, loan.paymentFrequency),
        ...amounts,
        isPaid: false
      }));
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
    if (
      loan.interestMethod === 'reducing_balance' &&
      !!loan.installments?.length &&
      loan.installments?.every(installment => installment.interestAmount !== undefined)
    ) {
      return loan.installments.reduce((sum, installment) => sum + (installment.interestAmount || 0), 0);
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
