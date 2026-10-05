import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ClientService } from '../../services/client.service';
import { LoanService } from '../../services/loan.service';
import { Observable, catchError, of, combineLatest, map, startWith } from 'rxjs';
import { Client } from '../../models/client.model';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-client-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './client-list.component.html',
  styleUrl: './client-list.component.css'
})
export class ClientListComponent {
  private clientService = inject(ClientService);
  private loanService = inject(LoanService);
  private auth = inject(AuthService);
  searchControl = new FormControl('');
  loadError: string | null = null;
  syncStatus$: Observable<{ fromCache: boolean; hasPendingWrites: boolean }> = combineLatest([
    this.clientService.getClientsSnapshot(),
    this.loanService.getLoansSnapshot()
  ]).pipe(
    map(([clients, loans]) => ({
      fromCache: clients.fromCache || loans.fromCache,
      hasPendingWrites: clients.hasPendingWrites || loans.hasPendingWrites
    })),
    catchError(() => {
      this.loadError = 'No se pudo confirmar la sincronización de los datos.';
      return of({ fromCache: false, hasPendingWrites: false });
    })
  );

  get isAdmin(): boolean {
    return this.auth.isAdmin;
  }

  clients$: Observable<Array<Client & { activeLoansCount: number }>> = combineLatest([
    this.clientService.getClients(),
    this.loanService.getLoans(),
    this.searchControl.valueChanges.pipe(startWith(''))
  ]).pipe(
    map(([clients, loans, searchTerm]) => {
      let mappedClients = clients.map(client => {
        const activeLoans = loans.filter(l => l.clientId === client.id && l.status === 'active');
        return {
          ...client,
          name: String(client.name ?? 'Sin nombre'),
          phone: String(client.phone ?? ''),
          documentId: String(client.documentId ?? ''),
          activeLoansCount: activeLoans.length
        };
      });

      const lowerTerm = String(searchTerm ?? '').trim().toLocaleLowerCase();
      if (lowerTerm) {
        mappedClients = mappedClients.filter(c =>
          c.name.toLocaleLowerCase().includes(lowerTerm) ||
          c.phone.toLocaleLowerCase().includes(lowerTerm) ||
          c.documentId.toLocaleLowerCase().includes(lowerTerm)
        );
      }
      return mappedClients;
    }),
    catchError(error => {
      console.error('Error al cargar clientes:', error);
      this.loadError = 'No se pudieron cargar los clientes. Verifica la conexión e inténtalo de nuevo.';
      return of([]);
    })
  );

  async deleteClient(id: string) {
    if (!this.auth.isAdmin) return;
    if (confirm('¿Estás seguro de que quieres eliminar este cliente?')) {
      try {
        await this.clientService.deleteClient(id);
      } catch (e) {
        console.error("Error eliminando cliente", e);
        alert(e instanceof Error ? e.message : "Hubo un error al eliminar el cliente.");
      }
    }
  }
}
