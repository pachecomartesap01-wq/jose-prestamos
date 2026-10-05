import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, startWith } from 'rxjs';
import { PaymentHistoryEntry, PaymentHistoryType } from '../models/payment-history.model';
import { LoanService } from '../services/loan.service';
import type { DocumentData, QueryDocumentSnapshot } from '@angular/fire/firestore';

@Component({
  selector: 'app-payment-history',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './payment-history.component.html'
})
export class PaymentHistoryComponent implements OnInit {
  private loanService = inject(LoanService);
  searchControl = new FormControl('');
  typeControl = new FormControl('all');
  startDateControl = new FormControl('');
  endDateControl = new FormControl('');
  loadError: string | null = null;
  hasMorePayments = false;
  isLoadingInitialPage = true;
  isLoadingMore = false;
  private readonly refreshPages$ = new BehaviorSubject(0);
  private olderPayments: PaymentHistoryEntry[] = [];
  private cursor?: QueryDocumentSnapshot<DocumentData>;

  payments$: Observable<PaymentHistoryEntry[]> = combineLatest([
    this.loanService.getPaymentHistory(),
    this.searchControl.valueChanges.pipe(startWith('')),
    this.typeControl.valueChanges.pipe(startWith('all')),
    this.startDateControl.valueChanges.pipe(startWith('')),
    this.endDateControl.valueChanges.pipe(startWith('')),
    this.refreshPages$
  ]).pipe(
    map(([payments, searchTerm, type, startDate, endDate]) => {
      const search = String(searchTerm ?? '').trim().toLocaleLowerCase();
      const start = this.parseDateBound(startDate, false);
      const end = this.parseDateBound(endDate, true);
      const allPayments = new Map([...payments, ...this.olderPayments].map(payment => [payment.id, payment]));
      return [...allPayments.values()].filter(payment => {
        const matchesSearch = !search || [
          payment.clientName,
          payment.collectedBy,
          payment.loanId,
          payment.clientId
        ].some(value => String(value ?? '').toLocaleLowerCase().includes(search));
        const collectedAt = payment.collectedAt.getTime();
        return matchesSearch &&
          (type === 'all' || payment.type === type) &&
          (!start || collectedAt >= start) &&
          (!end || collectedAt <= end);
      }).sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime());
    }),
    catchError(error => {
      console.error('Error al cargar el historial de cobros:', error);
      this.loadError = 'No se pudo cargar el historial. Verifica la conexión y vuelve a intentarlo.';
      return of([]);
    })
  );

  ngOnInit(): void {
    void this.loadInitialPage();
  }

  private async loadInitialPage(): Promise<void> {
    try {
      const page = await this.loanService.getPaymentHistoryPage();
      this.olderPayments = page.entries;
      this.cursor = page.cursor;
      this.hasMorePayments = page.hasMore;
      this.loadError = null;
      this.refreshPages$.next(1);
    } catch (error) {
      console.error('Error al cargar la primera página del historial:', error);
      this.loadError = 'No se pudo cargar el historial desde el servidor. Verifica la conexión e inténtalo de nuevo.';
    } finally {
      this.isLoadingInitialPage = false;
    }
  }

  async loadMorePayments(): Promise<void> {
    if (!this.hasMorePayments || this.isLoadingMore) return;
    this.isLoadingMore = true;
    try {
      const page = await this.loanService.getPaymentHistoryPage(this.cursor);
      const knownIds = new Set(this.olderPayments.map(payment => payment.id));
      this.olderPayments = [
        ...this.olderPayments,
        ...page.entries.filter(payment => !knownIds.has(payment.id))
      ];
      this.cursor = page.cursor;
      this.hasMorePayments = page.hasMore;
      this.loadError = null;
      this.refreshPages$.next(this.refreshPages$.value + 1);
    } catch (error) {
      console.error('Error al cargar más movimientos:', error);
      this.loadError = 'No se pudieron cargar más movimientos. Inténtalo de nuevo.';
    } finally {
      this.isLoadingMore = false;
    }
  }

  private parseDateBound(value: string | null, endOfDay: boolean): number | null {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    return Number.isFinite(date.getTime()) ? date.getTime() : null;
  }

  eventLabel(type: PaymentHistoryType): string {
    return {
      installment: 'Cobro de cuota',
      capital: 'Abono a capital',
      reversal: 'Anulación de cobro'
    }[type];
  }

  roleLabel(role: PaymentHistoryEntry['collectorRole']): string {
    return role === 'cashier' ? 'Cobrador de caja' : 'Administrador';
  }

  paymentMethodLabel(method: PaymentHistoryEntry['paymentMethod'], type?: PaymentHistoryType): string {
    if (type === 'reversal') return 'No aplica';
    return {
      cash: 'Efectivo',
      transfer: 'Transferencia',
      card: 'Tarjeta',
      other: 'Otro'
    }[method || 'cash'];
  }
}
