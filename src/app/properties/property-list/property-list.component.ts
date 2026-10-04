import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PropertyService } from '../../services/property.service';
import { ClientService } from '../../services/client.service';
import { Property } from '../../models/property.model';
import { Observable, combineLatest, map } from 'rxjs';

@Component({
  selector: 'app-property-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './property-list.component.html'
})
export class PropertyListComponent implements OnInit {
  private propertyService = inject(PropertyService);
  private clientService = inject(ClientService);

  properties$: Observable<any[]> | undefined;

  ngOnInit() {
    this.properties$ = combineLatest([
      this.propertyService.getProperties(),
      this.clientService.getClients()
    ]).pipe(
      map(([properties, clients]) => {
        return properties.map(property => {
          const tenant = property.tenantId ? clients.find(c => c.id === property.tenantId) : null;
          return {
            ...property,
            tenantName: tenant ? tenant.name : null
          };
        });
      })
    );
  }

  deleteProperty(id: string) {
    if (confirm('¿Estás seguro de que quieres eliminar esta propiedad?')) {
      this.propertyService.deleteProperty(id);
    }
  }
}
