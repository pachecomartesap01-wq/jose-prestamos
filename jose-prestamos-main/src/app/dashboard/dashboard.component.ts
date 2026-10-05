import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LoanService } from '../services/loan.service';
import { ClientService } from '../services/client.service';
import { catchError, Observable, map, combineLatest, of, shareReplay } from 'rxjs';
import { Loan, Installment } from '../models/loan.model';
import { CollectionSnapshot } from '../models/collection-snapshot.model';

interface UpcomingPayment {
  clientName: string;
  clientInitials: string;
  amount: number;
  dueDate: Date;
  statusText: string;
  isOverdue: boolean;
  loanId: string;
}

type DashboardLoan = Loan & {
  id: string;
  clientName: string;
  displayStartDate: Date | null;
  displayAmount: number | null;
  dataIncomplete: boolean;
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit {
  private loanService = inject(LoanService);
  private clientService = inject(ClientService);
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
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  loans$: Observable<DashboardLoan[]> = combineLatest([
    this.loanService.getLoansSnapshot(),
    this.clientService.getClientsSnapshot()
  ]).pipe(
    map(([loans, clients]) => {
      this.loadError = null;
      return loans.data.map(loan => {
        const client = clients.data.find(c => c.id === loan.clientId);
        const startDate = this.loanService.toDate(loan.startDate);
        const displayStartDate = Number.isFinite(startDate.getTime()) ? startDate : null;
        const clientName = String(client?.name ?? '').trim() || 'Cliente desconocido';
        const sourceInstallments = Array.isArray(loan.installments)
          ? loan.installments.filter((installment): installment is Installment =>
              !!installment && typeof installment === 'object')
          : [];
        const installments = this.loanService.isInterestOnly(loan) && displayStartDate
          ? this.loanService.syncInterestOnlyInstallments({ ...loan, installments: sourceInstallments })
          : sourceInstallments;
        const amount = this.finiteNumber(loan.amount);
        const dataIncomplete = !client ||
          !displayStartDate ||
          amount === null ||
          !['active', 'completed', 'defaulted'].includes(loan.status) ||
          (Array.isArray(loan.installments) && loan.installments.some(installment =>
            !installment || !Number.isFinite(this.finiteNumber(installment.amount)) ||
            !Number.isFinite(this.loanService.toDate(installment.dueDate).getTime())
          ));

        return {
          ...loan,
          installments,
          clientName,
          displayStartDate,
          displayAmount: amount,
          dataIncomplete
        };
      });
    }),
    catchError(error => {
      console.error('Error al cargar el resumen:', error);
      this.loadError = 'No se pudieron cargar los datos del resumen. Verifica la conexión e inténtalo de nuevo.';
      return of([]);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  totalPrestado$!: Observable<number>;
  totalRecuperado$!: Observable<number>;
  gananciaEsperada$!: Observable<number>;
  prestamosActivos$!: Observable<number>;
  cuotasVencidas$!: Observable<number>;
  saldoVencido$!: Observable<number>;
  
  prestamosRecientes$!: Observable<DashboardLoan[]>;
  proximosCobros$!: Observable<UpcomingPayment[]>;
  incompleteLoansCount$!: Observable<number>;

  ngOnInit() {
    this.totalPrestado$ = this.loans$.pipe(
      map(loans => loans.reduce((acc, loan) => acc + (loan.displayAmount ?? 0), 0))
    );

    this.gananciaEsperada$ = this.loans$.pipe(
      map(loans => loans.reduce((acc, loan) => {
        const interest = this.loanService.expectedInterest(loan);
        return acc + (Number.isFinite(interest) ? interest : 0);
      }, 0))
    );

    this.prestamosActivos$ = this.loans$.pipe(
      map(loans => loans.filter(l => l.status === 'active').length)
    );

    const overdueAmounts$ = this.loans$.pipe(
      map(loans => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return loans.map(loan => {
          if (loan.status !== 'active') return { count: 0, amount: 0 };
          return (loan.installments || []).reduce((summary, installment) => {
            if (installment.isPaid) return summary;
            const dueDate = this.loanService.toDate(installment.dueDate);
            if (!Number.isFinite(dueDate.getTime())) return summary;
            dueDate.setHours(0, 0, 0, 0);
            if (dueDate >= today) return summary;
            const amount = this.finiteNumber(installment.amount);
            const paid = this.finiteNumber(installment.paidAmount) ?? 0;
            const remaining = amount === null ? 0 : Math.max(0, amount - paid);
            return remaining > 0
              ? { count: summary.count + 1, amount: summary.amount + remaining }
              : summary;
          }, { count: 0, amount: 0 });
        });
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    this.cuotasVencidas$ = overdueAmounts$.pipe(
      map(summaries => summaries.reduce((total, summary) => total + summary.count, 0))
    );
    this.saldoVencido$ = overdueAmounts$.pipe(
      map(summaries => summaries.reduce((total, summary) => total + summary.amount, 0))
    );

    this.totalRecuperado$ = this.loans$.pipe(
      map(loans => {
        let recuperado = 0;
        loans.forEach(loan => {
          if (loan.installments) {
            recuperado += loan.installments
              .reduce((acc: number, inst: Installment) => {
                const amount = this.finiteNumber(inst.amount);
                const paidAmount = this.finiteNumber(inst.paidAmount);
                const collected = inst.isPaid
                  ? paidAmount ?? amount
                  : paidAmount;
                return acc + (collected !== null && collected > 0 ? collected : 0);
              }, 0);
          }
          // Abonos a capital de préstamos Solo Interés
          const capitalPayments = Array.isArray(loan.capitalPayments) ? loan.capitalPayments : [];
          recuperado += capitalPayments.reduce((acc, payment) => {
            const amount = this.finiteNumber(payment?.amount);
            return acc + (amount !== null && amount > 0 ? amount : 0);
          }, 0);
        });
        return recuperado;
      })
    );

    this.prestamosRecientes$ = this.loans$.pipe(
      map(loans => {
        return [...loans].sort((a, b) => {
          const dateA = a.displayStartDate?.getTime() ?? 0;
          const dateB = b.displayStartDate?.getTime() ?? 0;
          return dateB - dateA;
        }).slice(0, 5);
      })
    );

    this.incompleteLoansCount$ = this.loans$.pipe(
      map(loans => loans.filter(loan => loan.dataIncomplete).length)
    );

    this.proximosCobros$ = this.loans$.pipe(
      map(loans => {
        const upcoming: UpcomingPayment[] = [];
        const today = new Date();
        const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

        loans.filter(l => l.status === 'active').forEach(loan => {
          if (loan.installments) {
            loan.installments.filter((inst: Installment) => !inst.isPaid).forEach((inst: Installment) => {
              const dueDate = this.loanService.toDate(inst.dueDate);
              const amount = this.finiteNumber(inst.amount);
              if (!Number.isFinite(dueDate.getTime()) || amount === null || amount <= 0) return;

              const dueDateUtc = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
              const diffDays = Math.round((dueDateUtc - todayUtc) / 86_400_000);
              
              let statusText = '';
              let isOverdue = false;

              if (diffDays < 0) {
                statusText = `Venció hace ${Math.abs(diffDays)} días`;
                isOverdue = true;
              } else if (diffDays === 0) {
                statusText = 'Hoy';
              } else if (diffDays === 1) {
                statusText = 'Mañana';
              } else {
                statusText = `En ${diffDays} días`;
              }

              upcoming.push({
                clientName: loan.clientName,
                clientInitials: loan.clientName.substring(0, 2).toUpperCase(),
                amount,
                dueDate: dueDate,
                statusText,
                isOverdue,
                loanId: loan.id || ''
              });
            });
          }
        });

        return upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).slice(0, 5);
      })
    );
  }

  private finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
}
