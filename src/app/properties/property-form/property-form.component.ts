import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PropertyService } from '../../services/property.service';
import { ClientService } from '../../services/client.service';

@Component({
  selector: 'app-property-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './property-form.component.html'
})
export class PropertyFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private propertyService = inject(PropertyService);
  private clientService = inject(ClientService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  propertyForm: FormGroup;
  clients$ = this.clientService.getClients();
  
  isEditMode = false;
  propertyId: string | null = null;
  isSubmitting = false;

  constructor() {
    this.propertyForm = this.fb.group({
      address: ['', Validators.required],
      description: [''],
      rentAmount: [0, [Validators.required, Validators.min(1)]],
      status: ['available', Validators.required],
      tenantId: [null]
    });
  }

  ngOnInit() {
    this.propertyId = this.route.snapshot.paramMap.get('id');
    if (this.propertyId) {
      this.isEditMode = true;
      this.propertyService.getProperties().subscribe(properties => {
        const property = properties.find(p => p.id === this.propertyId);
        if (property) {
          this.propertyForm.patchValue({
            address: property.address,
            description: property.description,
            rentAmount: property.rentAmount,
            status: property.status,
            tenantId: property.tenantId
          });
        }
      });
    }

    // React to status changes
    this.propertyForm.get('status')?.valueChanges.subscribe(status => {
      const tenantCtrl = this.propertyForm.get('tenantId');
      if (status === 'available') {
        tenantCtrl?.setValue(null);
        tenantCtrl?.disable();
      } else {
        tenantCtrl?.enable();
      }
    });
  }

  async onSubmit() {
    if (this.propertyForm.valid) {
      this.isSubmitting = true;
      const formValue = this.propertyForm.getRawValue();
      
      const propertyData = {
        ...formValue,
        tenantId: formValue.status === 'rented' ? formValue.tenantId : null
      };

      try {
        if (this.isEditMode && this.propertyId) {
          await this.propertyService.updateProperty(this.propertyId, propertyData);
        } else {
          await this.propertyService.createProperty({
            ...propertyData,
            payments: [],
            createdAt: new Date()
          });
        }
        this.router.navigate(['/properties']);
      } catch (error) {
        console.error('Error saving property', error);
        this.isSubmitting = false;
      }
    } else {
      this.propertyForm.markAllAsTouched();
    }
  }
}
