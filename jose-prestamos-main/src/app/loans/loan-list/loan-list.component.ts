import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Observable, catchError, combineLatest, map, of, startWith } from 'rxjs';
import { Loan } from '../../models/loan.model';
import { Client } from '../../models/client.model';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-loan-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './loan-list.component.html',
  styleUrl: './loan-list.component.css'
})
export class LoanListComponent {
  private loanService = inject(LoanService);
  private clientService = inject(ClientService);
  private auth = inject(AuthService);

  searchControl = new FormControl('');
  statusControl = new FormControl('all');
  loadError: string | null = null;
  syncStatus$: Observable<{ fromCache: boolean; hasPendingWrites: boolean }> = combineLatest([
    this.loanService.getLoansSnapshot(),
    this.clientService.getClientsSnapshot()
  ]).pipe(
    map(([loans, clients]) => ({
      fromCache: loans.fromCache || clients.fromCache,
      hasPendingWrites: loans.hasPendingWrites || clients.hasPendingWrites
    })),
    catchError(() => {
      this.loadError = 'No se pudo confirmar la sincronización de los datos.';
      return of({ fromCache: false, hasPendingWrites: false });
    })
  );

  get isAdmin(): boolean {
    return this.auth.isAdmin;
  }

  get isCashier(): boolean {
    return this.auth.isCashier;
  }

  loans$: Observable<Array<Loan & {
    id: string;
    displayStartDate: Date | null;
    clientName: string;
    clientPhone: string;
    clientDocumentId: string;
    progress: number;
    termsLabel: string;
    overdueAmount: number;
  }>> = combineLatest([
    this.loanService.getLoans(),
    this.clientService.getClients(),
    this.searchControl.valueChanges.pipe(startWith('')),
    this.statusControl.valueChanges.pipe(startWith('all'))
  ]).pipe(
    map(([loans, clients, searchTerm, statusFilter]) => {
      let filtered = loans.map(loan => {
        const client = clients.find(c => c.id === loan.clientId);
        const startDate = this.loanService.toDate(loan.startDate);
        const installments = this.loanService.isInterestOnly(loan)
          ? this.loanService.syncInterestOnlyInstallments(loan)
          : loan.installments;
        const loanWithCurrentInstallments = { ...loan, installments };
        return {
          ...loanWithCurrentInstallments,
          displayStartDate: Number.isFinite(startDate.getTime()) ? startDate : null,
          clientName: String(client?.name ?? 'Cliente Desconocido'),
          clientPhone: String(client?.phone ?? ''),
          clientDocumentId: String(client?.documentId ?? ''),
          progress: this.calculateProgress(loan),
          termsLabel: this.termsLabel(loan),
          overdueAmount: this.calculateOverdueAmount(loanWithCurrentInstallments)
        };
      });

      if (statusFilter === 'overdue') {
        filtered = filtered.filter(loan => loan.overdueAmount > 0);
      } else if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter(l => l.status === statusFilter);
      }

      const lowerTerm = String(searchTerm ?? '').trim().toLocaleLowerCase();
      if (lowerTerm) {
        filtered = filtered.filter(l =>
          [l.clientName, l.clientPhone, l.clientDocumentId]
            .some(value => value.toLocaleLowerCase().includes(lowerTerm))
        );
      }

      return filtered;
    }),
    catchError(error => {
      console.error('Error al cargar préstamos:', error);
      this.loadError = 'No se pudieron cargar los préstamos. Verifica la conexión e inténtalo de nuevo.';
      return of([]);
    })
  );

  private termsLabel(loan: Loan): string {
    const rate = `${loan.interestRate}% ${this.loanService.interestPeriodLabel(loan.interestPeriod)}`;
    const freq = this.loanService.frequencyLabel(loan.paymentFrequency);
    if (this.loanService.isInterestOnly(loan)) {
      const balance = loan.principalBalance ?? loan.amount;
      return `Solo interés · ${rate} · ${freq} · Capital pendiente $${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const method = loan.interestMethod === 'reducing_balance' ? 'saldo decreciente' : 'monto inicial';
    return `Capital + interés (${method}) · ${rate} · ${loan.duration} cuotas (${freq})`;
  }

  private calculateProgress(loan: Loan): number {
    // Solo Interés: el progreso es el capital devuelto
    if (this.loanService.isInterestOnly(loan)) {
      if (!loan.amount) return 0;
      const balance = loan.principalBalance ?? loan.amount;
      return Math.min(100, Math.max(0, ((loan.amount - balance) / loan.amount) * 100));
    }

    if (!loan.installments || loan.installments.length === 0) return 0;
    
    const totalExpected = loan.installments.reduce((sum, inst) => sum + inst.amount, 0);
    if (totalExpected === 0) return 100;
    
    const totalPaid = loan.installments.reduce((sum, inst) => {
      if (inst.isPaid) return sum + inst.amount;
      return sum + (inst.paidAmount || 0);
    }, 0);
    
    return Math.min(100, Math.max(0, (totalPaid / totalExpected) * 100));
  }

  private calculateOverdueAmount(loan: Loan): number {
    if (loan.status !== 'active') return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (loan.installments || []).reduce((total, installment) => {
      if (installment.isPaid) return total;
      const dueDate = this.loanService.toDate(installment.dueDate);
      if (!Number.isFinite(dueDate.getTime())) return total;
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate >= today) return total;
      const remaining = Math.max(0, installment.amount - (installment.paidAmount || 0));
      return total + Math.round(remaining * 100) / 100;
    }, 0);
  }

  async deleteLoan(id: string) {
    if (!this.auth.isAdmin) return;
    if (confirm('¿Estás seguro de que deseas eliminar este préstamo? Toda la información de cuotas se perderá de forma permanente.')) {
      try {
        await this.loanService.deleteLoan(id);
      } catch (e) {
        console.error("Error al eliminar", e);
        alert(e instanceof Error ? e.message : "Ocurrió un error al eliminar el préstamo.");
      }
    }
  }
}
