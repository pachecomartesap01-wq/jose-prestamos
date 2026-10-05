import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { AuthService } from '../../services/auth.service';
import { Observable, BehaviorSubject, switchMap, map, tap } from 'rxjs';
import { Loan, Installment } from '../../models/loan.model';
import { PaymentActor, PaymentMethod } from '../../models/payment-history.model';
import { PaymentReceipt, PaymentReceiptService } from '../../services/payment-receipt.service';

@Component({
  selector: 'app-loan-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './loan-detail.component.html',
  styleUrl: './loan-detail.component.css'
})
export class LoanDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  loanService = inject(LoanService);
  private clientService = inject(ClientService);
  auth = inject(AuthService);
  private receiptService = inject(PaymentReceiptService);

  loan$: Observable<any> | undefined;
  lastReceipt: PaymentReceipt | null = null;
  paymentConfirmation: {
    clientName: string;
    loanId: string;
    description: string;
    amount: number;
    paymentMethod: PaymentMethod;
  } | null = null;
  isConfirmingPayment = false;
  private pendingPaymentAction?: (paymentMethod: PaymentMethod) => Promise<void>;

  /** Evita escribir varias veces la misma sincronización de cuotas. */
  private lastSyncKey = '';

  ngOnInit() {
    this.loan$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        // Simple way to get single loan: get all and filter (for now, ideal is getDoc)
        return this.loanService.getLoans().pipe(
          map(loans => loans.find(l => l.id === id))
        );
      }),
      tap(loan => {
        if (loan) this.syncInterestOnly(loan);
      }),
      switchMap(loan => {
        if (!loan) return [null];
        return this.clientService.getClients().pipe(
          map(clients => {
            const client = clients.find(c => c.id === loan.clientId);
            
            // Convertir fechas de Firebase a objetos Date de JS para que Angular DatePipe no falle
            const parsedStartDate = this.loanService.toDate(loan.startDate);

            const parsedInstallments = (loan.installments || []).map((inst: any) => ({
              ...inst,
              dueDate: this.loanService.toDate(inst.dueDate)
            }));

            const parsedCapitalPayments = (loan.capitalPayments || []).map((p: any) => ({
              ...p,
              date: this.loanService.toDate(p.date)
            }));

            const isInterestOnly = this.loanService.isInterestOnly(loan);
            const principalBalance = loan.principalBalance ?? loan.amount;

            return {
              ...loan,
              startDate: parsedStartDate,
              installments: parsedInstallments,
              capitalPayments: parsedCapitalPayments,
              isInterestOnly,
              principalBalance,
              capitalPaid: loan.amount - principalBalance,
              nextInterest: isInterestOnly ? this.loanService.interestOnlyPayment(principalBalance, loan) : 0,
              frequencyLabel: this.loanService.frequencyLabel(loan.paymentFrequency),
              interestPeriodLabel: this.loanService.interestPeriodLabel(loan.interestPeriod),
              clientName: client ? client.name : 'Desconocido',
              clientPhone: client ? client.phone : ''
            };
          })
        );
      })
    );
  }

  /** Préstamos de Solo Interés: genera las cuotas de interés que ya correspondan. */
  private async syncInterestOnly(loan: Loan) {
    if (!this.auth.isAdmin || !loan.id || !this.loanService.isInterestOnly(loan) || loan.status !== 'active') return;

    const current = loan.installments || [];
    const synced = this.loanService.syncInterestOnlyInstallments(loan);
    if (synced.length === current.length) return;

    const key = `${loan.id}:${synced.length}`;
    if (this.lastSyncKey === key) return;
    this.lastSyncKey = key;

    try {
      await this.loanService.updateLoan(loan.id, { installments: synced });
    } catch (e) {
      console.error('Error al generar cuotas de interés', e);
    }
  }

  async toggleInstallmentStatus(loan: any, index: number) {
    if (!this.auth.isAdmin) return;
    if (!loan || !loan.installments) return;

    try {
      const actor = this.getPaymentActor();
      if (loan.installments[index].isPaid) {
        if (!confirm(`¿Confirmas anular el pago de la cuota ${index + 1} de ${loan.clientName}?`)) return;
        await this.loanService.reverseInstallment(loan.id, index, actor, loan.clientName);
      } else {
        const installment = loan.installments[index];
        const remaining = installment.amount - (installment.paidAmount || 0);
        this.requestPaymentConfirmation(
          loan,
          `Cobrar cuota ${index + 1}`,
          remaining,
          async paymentMethod => {
            const receipt = await this.loanService.collectInstallment(
              loan.id, index, remaining, actor, loan.clientName, paymentMethod
            );
            this.setLastReceipt(receipt, loan.clientPhone);
          }
        );
      }
    } catch (error) {
      console.error('Error al actualizar el cobro', error);
      alert(error instanceof Error ? error.message : 'Error al actualizar el cobro.');
    }
  }

  async deleteLoan(id: string) {
    if (!this.auth.isAdmin) return;
    if (confirm('¿Estás seguro de que deseas eliminar este préstamo permanentemente?')) {
      try {
        await this.loanService.deleteLoan(id);
        this.router.navigate(['/loans']);
      } catch (e) {
        console.error("Error al eliminar", e);
        alert(e instanceof Error ? e.message : "Ocurrió un error al eliminar el préstamo.");
      }
    }
  }

  async registerAbono(loan: any, index: number) {
    if (!this.auth.isAdmin) return;
    if (!loan || !loan.installments) return;
    
    const installment = loan.installments[index];
    if (installment.isPaid) return;

    const currentPaid = installment.paidAmount || 0;
    const remaining = installment.amount - currentPaid;

    const input = prompt(`La cuota es de $${installment.amount.toFixed(2)}.\nFalta pagar $${remaining.toFixed(2)}.\n\n¿Cuánto abonará el cliente ahora?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0.");
      return;
    }

    this.requestPaymentConfirmation(loan, `Abonar a cuota ${index + 1}`, amount, async paymentMethod => {
      const receipt = await this.loanService.collectInstallment(
        loan.id,
        index,
        amount,
        this.getPaymentActor(),
        loan.clientName,
        paymentMethod
      );
      this.setLastReceipt(receipt, loan.clientPhone);
    });
  }

  async registerAbonoCapital(loan: any) {
    if (!this.auth.isAdmin) return;
    if (loan?.isInterestOnly) {
      return this.registerCapitalPaymentInterestOnly(loan);
    }

    if (!loan?.installments?.length) return;

    const currentTotalPending = loan.installments
      .filter((installment: Installment) => !installment.isPaid)
      .reduce((sum: number, installment: Installment) =>
        sum + installment.amount - (installment.paidAmount || 0), 0);
    const availableCapital = loan.interestMethod === 'reducing_balance'
      ? this.loanService.amortizedOutstandingPrincipal(loan)
      : currentTotalPending;
    if (availableCapital <= 0) {
      alert('No hay cuotas pendientes para abonar a capital.');
      return;
    }

    const pendingLabel = loan.interestMethod === 'reducing_balance'
      ? `El capital pendiente es $${availableCapital.toFixed(2)}.`
      : `El total pendiente es $${availableCapital.toFixed(2)}.`;
    const input = prompt(`${pendingLabel}\n\n¿De cuánto será el Abono Extraordinario a Capital?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0.");
      return;
    }

    this.requestPaymentConfirmation(loan, 'Abonar a capital', amount, async paymentMethod => {
      const receipt = await this.loanService.collectAmortizedCapital(
        loan.id,
        amount,
        this.getPaymentActor(),
        loan.clientName,
        paymentMethod
      );
      this.setLastReceipt(receipt, loan.clientPhone);
    });
  }

  /**
   * Solo Interés: el abono reduce el capital pendiente. Las cuotas de interés ya generadas
   * (vencidas y la del período en curso) se mantienen; las siguientes se calculan
   * sobre el nuevo capital.
   */
  private async registerCapitalPaymentInterestOnly(loan: any) {
    const balance: number = loan.principalBalance ?? loan.amount;
    if (balance <= 0) {
      alert('Este préstamo ya no tiene capital pendiente.');
      return;
    }

    const input = prompt(`Capital pendiente: $${balance.toFixed(2)}.\n\n¿Cuánto abonará el cliente al capital?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert('Por favor ingresa un monto válido mayor a 0.');
      return;
    }
    this.requestPaymentConfirmation(loan, 'Abonar a capital', amount, async paymentMethod => {
      const result = await this.loanService.collectInterestOnlyCapital(
        loan.id,
        amount,
        this.getPaymentActor(),
        loan.clientName,
        paymentMethod
      );
      this.setLastReceipt(result.receipt, loan.clientPhone);
    });
  }

  async collectInstallment(loan: Loan, index: number) {
    if (!this.auth.isCashier || !loan.id) return;

    const installment = loan.installments?.[index];
    if (!installment || installment.isPaid) return;

    const remaining = Math.round((installment.amount - (installment.paidAmount || 0)) * 100) / 100;
    const input = prompt(`Saldo pendiente de esta cuota: $${remaining.toFixed(2)}.\n\n¿Cuánto dinero recibe de caja?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Ingresa un monto válido mayor que cero.');
      return;
    }

    const clientName = String((loan as Loan & { clientName?: string }).clientName || 'Cliente desconocido');
    this.requestPaymentConfirmation(loan, `Cobrar cuota ${index + 1}`, amount, async paymentMethod => {
      const receipt = await this.loanService.collectInstallment(
        loan.id!,
        index,
        amount,
        this.getPaymentActor(),
        clientName,
        paymentMethod
      );
      this.setLastReceipt(receipt, (loan as Loan & { clientPhone?: string }).clientPhone);
    });
  }

  cancelPaymentConfirmation(): void {
    if (this.isConfirmingPayment) return;
    this.paymentConfirmation = null;
    this.pendingPaymentAction = undefined;
  }

  async confirmPayment(): Promise<void> {
    if (!this.paymentConfirmation || !this.pendingPaymentAction || this.isConfirmingPayment) return;

    this.isConfirmingPayment = true;
    try {
      await this.pendingPaymentAction(this.paymentConfirmation.paymentMethod);
      this.paymentConfirmation = null;
      this.pendingPaymentAction = undefined;
    } catch (error) {
      console.error('Error al confirmar el pago', error);
      alert(error instanceof Error ? error.message : 'No se pudo registrar el pago. Inténtalo de nuevo.');
    } finally {
      this.isConfirmingPayment = false;
    }
  }

  setConfirmationPaymentMethod(event: Event): void {
    if (!this.paymentConfirmation || this.isConfirmingPayment) return;
    const method = (event.target as HTMLSelectElement).value as PaymentMethod;
    if (['cash', 'transfer', 'card', 'other'].includes(method)) {
      this.paymentConfirmation.paymentMethod = method;
    }
  }

  private requestPaymentConfirmation(
    loan: Loan & { clientName?: string },
    description: string,
    amount: number,
    action: (paymentMethod: PaymentMethod) => Promise<void>
  ): void {
    if (this.isConfirmingPayment) return;
    this.paymentConfirmation = {
      clientName: loan.clientName || 'Cliente desconocido',
      loanId: loan.id || '',
      description,
      amount,
      paymentMethod: 'cash'
    };
    this.pendingPaymentAction = action;
  }

  private getPaymentActor(): PaymentActor {
    const role = this.auth.currentRole;
    const username = this.auth.currentUsername;
    if (!role || !username) throw new Error('La sesión no tiene un usuario cobrador válido.');
    return { role, username };
  }

  async downloadReceipt(receipt: PaymentReceipt): Promise<void> {
    try {
      await this.receiptService.download(receipt);
    } catch (error) {
      console.error('No se pudo generar el comprobante', error);
      alert('No se pudo descargar el comprobante. Inténtalo de nuevo.');
    }
  }

  async shareReceipt(receipt: PaymentReceipt): Promise<void> {
    try {
      const sharedFile = await this.receiptService.share(receipt);
      if (!sharedFile) {
        alert('Se descargó el PDF y se abrió WhatsApp con los datos del cobro. Adjunta el archivo PDF al mensaje antes de enviarlo.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('No se pudo compartir el comprobante', error);
      alert('No se pudo compartir el comprobante. Descárgalo e inténtalo de nuevo.');
    }
  }

  private setLastReceipt(receipt: PaymentReceipt, clientPhone?: string): void {
    this.lastReceipt = { ...receipt, clientPhone };
    void this.downloadReceipt(this.lastReceipt);
  }
}
