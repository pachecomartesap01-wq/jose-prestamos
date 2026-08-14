import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { PropertyService } from '../../services/property.service';
import { ClientService } from '../../services/client.service';
import { Observable, switchMap, map } from 'rxjs';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-property-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './property-detail.component.html'
})
export class PropertyDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private propertyService = inject(PropertyService);
  private clientService = inject(ClientService);

  property$: Observable<any> | undefined;
  
  // Payment Form state
  showPaymentForm = false;
  paymentAmount = 0;
  paymentDate = new Date().toISOString().split('T')[0]; // today
  paymentNotes = '';
  isSubmitting = false;

  ngOnInit() {
    this.property$ = this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        return this.propertyService.getProperties().pipe(
          map(properties => properties.find(p => p.id === id))
        );
      }),
      switchMap(property => {
        if (!property) return [null];
        this.paymentAmount = property.rentAmount; // Default payment to rent amount
        
        // Parse payments
        const parsedPayments = (property.payments || []).map((p: any) => {
           let dDate = p.date;
           if (p.date && p.date.toDate) {
             dDate = p.date.toDate();
           } else if (typeof p.date === 'string' || typeof p.date === 'number') {
             dDate = new Date(p.date);
           }
           return { ...p, date: dDate };
        });
        parsedPayments.sort((a: any, b: any) => b.date.getTime() - a.date.getTime()); // Descending
        
        return this.clientService.getClients().pipe(
          map(clients => {
            const tenant = property.tenantId ? clients.find(c => c.id === property.tenantId) : null;
            return {
              ...property,
              tenantName: tenant ? tenant.name : null,
              tenantPhone: tenant ? tenant.phone : null,
              payments: parsedPayments
            };
          })
        );
      })
    );
  }

  openPaymentForm() {
    this.showPaymentForm = true;
  }

  closePaymentForm() {
    this.showPaymentForm = false;
    this.paymentNotes = '';
  }

  async savePayment(property: any) {
    if (this.paymentAmount <= 0) return;
    this.isSubmitting = true;
    
    try {
      const newPayment = {
        id: Date.now().toString(),
        amount: this.paymentAmount,
        date: new Date(this.paymentDate),
        notes: this.paymentNotes
      };
      
      const currentPayments = property.payments || [];
      const updatedPayments = [...currentPayments, newPayment];
      
      await this.propertyService.addPayment(property.id, updatedPayments);
      this.closePaymentForm();
    } catch (error) {
      console.error('Error saving payment', error);
    } finally {
      this.isSubmitting = false;
    }
  }
}
