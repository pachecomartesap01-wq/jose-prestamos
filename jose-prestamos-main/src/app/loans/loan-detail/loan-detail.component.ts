import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Observable, BehaviorSubject, switchMap, map, tap } from 'rxjs';
import { Loan, Installment, CapitalPayment } from '../../models/loan.model';

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

  loan$: Observable<any> | undefined;

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
    if (!loan.id || !this.loanService.isInterestOnly(loan) || loan.status !== 'active') return;

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

  private async saveInstallments(loan: any, installments: Installment[], errorMsg: string) {
    try {
      await this.loanService.updateLoan(loan.id, {
        installments,
        status: this.loanService.resolveStatus(loan, installments)
      });
    } catch (e) {
      console.error(errorMsg, e);
      alert(errorMsg);
    }
  }

  async toggleInstallmentStatus(loan: any, index: number) {
    if (!loan || !loan.installments) return;
    
    const updatedInstallments = [...loan.installments];
    const installment = updatedInstallments[index];
    
    installment.isPaid = !installment.isPaid;
    if (installment.isPaid) {
      installment.paidDate = new Date();
      installment.paidAmount = installment.amount;
    } else {
      installment.paidDate = undefined;
      installment.paidAmount = 0;
    }
    
    await this.saveInstallments(loan, updatedInstallments, 'Error al guardar el pago');
  }

  async deleteLoan(id: string) {
    if (confirm('¿Estás seguro de que deseas eliminar este préstamo permanentemente?')) {
      try {
        await this.loanService.deleteLoan(id);
        this.router.navigate(['/loans']);
      } catch (e) {
        console.error("Error al eliminar", e);
        alert("Ocurrió un error al eliminar el préstamo.");
      }
    }
  }

  async registerAbono(loan: any, index: number) {
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

    const updatedInstallments = [...loan.installments];
    const updatedInstallment = updatedInstallments[index];

    const newTotalPaid = currentPaid + amount;

    if (newTotalPaid >= updatedInstallment.amount) {
      updatedInstallment.isPaid = true;
      updatedInstallment.paidAmount = updatedInstallment.amount;
      updatedInstallment.paidDate = new Date();
      alert("¡El abono cubre el total de la cuota! Se marcará como pagada.");
    } else {
      updatedInstallment.paidAmount = newTotalPaid;
    }

    await this.saveInstallments(loan, updatedInstallments, 'Error al guardar el abono');
  }

  async registerAbonoCapital(loan: any) {
    if (loan?.isInterestOnly) {
      return this.registerCapitalPaymentInterestOnly(loan);
    }

    if (!loan || !loan.installments) return;
    
    const unpaidIndices = loan.installments
      .map((inst: any, index: number) => ({ inst, index }))
      .filter((item: any) => !item.inst.isPaid);

    if (unpaidIndices.length === 0) {
      alert("No hay cuotas pendientes para abonar a capital.");
      return;
    }

    const currentTotalPending = unpaidIndices.reduce((sum: number, item: any) => {
      const remaining = item.inst.amount - (item.inst.paidAmount || 0);
      return sum + remaining;
    }, 0);

    const input = prompt(`El total pendiente de las ${unpaidIndices.length} cuotas restantes es $${currentTotalPending.toFixed(2)}.\n\n¿De cuánto será el Abono Extraordinario a Capital?`);
    if (input === null || input.trim() === '') return;

    const amount = Number(input);
    if (isNaN(amount) || amount <= 0) {
      alert("Por favor ingresa un monto válido mayor a 0.");
      return;
    }

    if (amount >= currentTotalPending) {
      alert("El abono es igual o mayor a la deuda total. Mejor usa los botones de 'Cobrar Todo' en las cuotas para saldar el préstamo.");
      return;
    }

    const deductionPerInstallment = amount / unpaidIndices.length;
    const updatedInstallments = [...loan.installments];
    
    for (const item of unpaidIndices) {
      const idx = item.index;
      updatedInstallments[idx].amount = Math.max(0, updatedInstallments[idx].amount - deductionPerInstallment);
      
      if (updatedInstallments[idx].paidAmount && updatedInstallments[idx].paidAmount >= updatedInstallments[idx].amount) {
         updatedInstallments[idx].isPaid = true;
         updatedInstallments[idx].paidDate = new Date();
         updatedInstallments[idx].paidAmount = updatedInstallments[idx].amount;
      }
    }

    try {
      await this.loanService.updateLoan(loan.id, { installments: updatedInstallments });
      alert("Abono a capital registrado exitosamente. Las cuotas futuras han disminuido.");
    } catch (e) {
      console.error("Error al registrar abono a capital", e);
      alert("Error al guardar el abono a capital");
    }
  }

  /**
   * Solo Interés: el abono reduce el capital pendiente. Las cuotas de interés ya generadas
   * (vencidas y la del período en curso) se mantienen; las siguientes se calculan
   * sobre el nuevo capital.
   */
  private async registerCapitalPaymentInterestOnly(loan: any) {
    const balance: number = loan.principalBalance;
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
    if (amount > balance + 0.001) {
      alert(`El abono no puede ser mayor al capital pendiente ($${balance.toFixed(2)}).`);
      return;
    }

    const newBalance = Math.max(0, Math.round((balance - amount) * 100) / 100);
    const payment: CapitalPayment = { date: new Date(), amount, balanceAfter: newBalance };
    const capitalPayments = [...(loan.capitalPayments || []), payment];
    const installments: Installment[] = loan.installments || [];
    const status = this.loanService.resolveStatus(loan, installments, newBalance);

    try {
      await this.loanService.updateLoan(loan.id, { principalBalance: newBalance, capitalPayments, status });
      if (newBalance === 0) {
        const pending = installments.filter(i => !i.isPaid).length;
        alert(pending > 0
          ? `¡Capital saldado! Quedan ${pending} cuota(s) de interés pendientes por cobrar.`
          : '¡Capital saldado! El préstamo queda completado.');
      } else {
        const next = this.loanService.interestOnlyPayment(newBalance, loan);
        alert(`Abono registrado. Capital pendiente: $${newBalance.toFixed(2)}.\nPróximas cuotas de interés: $${next.toFixed(2)}.`);
      }
    } catch (e) {
      console.error('Error al registrar abono a capital', e);
      alert('Error al guardar el abono a capital');
    }
  }
}
