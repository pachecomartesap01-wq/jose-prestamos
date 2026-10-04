import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Observable, combineLatest, map, startWith } from 'rxjs';
import { Loan } from '../../models/loan.model';
import { Client } from '../../models/client.model';

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

  searchControl = new FormControl('');
  statusControl = new FormControl('all');

  loans$: Observable<any[]> = combineLatest([
    this.loanService.getLoans(),
    this.clientService.getClients(),
    this.searchControl.valueChanges.pipe(startWith('')),
    this.statusControl.valueChanges.pipe(startWith('all'))
  ]).pipe(
    map(([loans, clients, searchTerm, statusFilter]) => {
      let filtered = loans.map(loan => {
        const client = clients.find(c => c.id === loan.clientId);
        return {
          ...loan,
          clientName: client ? client.name : 'Cliente Desconocido',
          progress: this.calculateProgress(loan)
        };
      });

      if (statusFilter && statusFilter !== 'all') {
        filtered = filtered.filter(l => l.status === statusFilter);
      }

      if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        filtered = filtered.filter(l => l.clientName.toLowerCase().includes(lowerTerm));
      }

      return filtered;
    })
  );

  private calculateProgress(loan: Loan): number {
    if (!loan.installments || loan.installments.length === 0) return 0;
    
    const totalExpected = loan.installments.reduce((sum, inst) => sum + inst.amount, 0);
    if (totalExpected === 0) return 100;
    
    const totalPaid = loan.installments.reduce((sum, inst) => {
      if (inst.isPaid) return sum + inst.amount;
      return sum + (inst.paidAmount || 0);
    }, 0);
    
    return Math.min(100, Math.max(0, (totalPaid / totalExpected) * 100));
  }

  async deleteLoan(id: string) {
    if (confirm('¿Estás seguro de que deseas eliminar este préstamo? Toda la información de cuotas se perderá de forma permanente.')) {
      try {
        await this.loanService.deleteLoan(id);
      } catch (e) {
        console.error("Error al eliminar", e);
        alert("Ocurrió un error al eliminar el préstamo.");
      }
    }
  }
}
