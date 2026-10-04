import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LoanService } from '../services/loan.service';
import { ClientService } from '../services/client.service';
import { Observable, map, combineLatest, shareReplay } from 'rxjs';
import { Loan, Installment } from '../models/loan.model';
import { Client } from '../models/client.model';

interface UpcomingPayment {
  clientName: string;
  clientInitials: string;
  amount: number;
  dueDate: Date;
  statusText: string;
  isOverdue: boolean;
  loanId: string;
}

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

  // Combine loans with clients to get client names
  loans$: Observable<(Loan & { clientName: string })[]> = combineLatest([
    this.loanService.getLoans(),
    this.clientService.getClients()
  ]).pipe(
    map(([loans, clients]) => {
      return loans.map(loan => {
        const client = clients.find(c => c.id === loan.clientId);
        return {
          ...loan,
          clientName: client ? client.name : 'Desconocido'
        };
      });
    }),
    shareReplay(1)
  );

  totalPrestado$!: Observable<number>;
  totalRecuperado$!: Observable<number>;
  gananciaEsperada$!: Observable<number>;
  prestamosActivos$!: Observable<number>;
  
  prestamosRecientes$!: Observable<(Loan & { clientName: string })[]>;
  proximosCobros$!: Observable<UpcomingPayment[]>;

  ngOnInit() {
    this.totalPrestado$ = this.loans$.pipe(
      map(loans => loans.reduce((acc, loan) => acc + loan.amount, 0))
    );

    this.gananciaEsperada$ = this.loans$.pipe(
      map(loans => loans.reduce((acc, loan) => acc + (loan.amount * (loan.interestRate / 100)), 0))
    );

    this.prestamosActivos$ = this.loans$.pipe(
      map(loans => loans.filter(l => l.status === 'active').length)
    );

    this.totalRecuperado$ = this.loans$.pipe(
      map(loans => {
        let recuperado = 0;
        loans.forEach(loan => {
          if (loan.installments) {
            recuperado += loan.installments
              .filter((inst: Installment) => inst.isPaid)
              .reduce((acc: number, inst: Installment) => acc + inst.amount, 0);
          }
        });
        return recuperado;
      })
    );

    this.prestamosRecientes$ = this.loans$.pipe(
      map(loans => {
        return [...loans].sort((a, b) => {
          const dateA = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
          const dateB = b.startDate instanceof Date ? b.startDate : new Date(b.startDate);
          return dateB.getTime() - dateA.getTime();
        }).slice(0, 5);
      })
    );

    this.proximosCobros$ = this.loans$.pipe(
      map(loans => {
        const upcoming: UpcomingPayment[] = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        loans.filter(l => l.status === 'active').forEach(loan => {
          if (loan.installments) {
            loan.installments.filter((inst: Installment) => !inst.isPaid).forEach((inst: Installment) => {
              let dueDate: Date;
              if (inst.dueDate instanceof Date) {
                dueDate = inst.dueDate;
              } else if ((inst.dueDate as any)?.toDate) {
                dueDate = (inst.dueDate as any).toDate();
              } else {
                dueDate = new Date(inst.dueDate);
              }
              
              const diffTime = dueDate.getTime() - today.getTime();
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
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
                amount: inst.amount,
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
}
