import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ClientService } from '../../services/client.service';
import { LoanService } from '../../services/loan.service';
import { Observable, catchError, of, combineLatest, map, startWith } from 'rxjs';
import { Client } from '../../models/client.model';

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
  searchControl = new FormControl('');

  private rawClients$ = this.clientService.getClients().pipe(
    catchError(err => {
      console.error('Error al cargar clientes:', err);
      alert('Error de Firebase al leer: ' + (err.message || err));
      return of([]); // Retorna array vacío para quitar el loading
    })
  );

  clients$: Observable<any[]> = combineLatest([
    this.rawClients$,
    this.loanService.getLoans(),
    this.searchControl.valueChanges.pipe(startWith(''))
  ]).pipe(
    map(([clients, loans, searchTerm]) => {
      let mappedClients = clients.map(client => {
        const activeLoans = loans.filter(l => l.clientId === client.id && l.status === 'active');
        return {
          ...client,
          activeLoansCount: activeLoans.length
        };
      });

      if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        mappedClients = mappedClients.filter(c => 
          c.name.toLowerCase().includes(lowerTerm) || 
          c.phone.includes(lowerTerm) ||
          (c.documentId && c.documentId.includes(lowerTerm))
        );
      }
      return mappedClients;
    })
  );

  async deleteClient(id: string) {
    if (confirm('¿Estás seguro de que quieres eliminar este cliente?')) {
      try {
        await this.clientService.deleteClient(id);
      } catch (e) {
        console.error("Error eliminando cliente", e);
        alert("Hubo un error al eliminar el cliente");
      }
    }
  }
}
