import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ClientService } from '../../services/client.service';
import { Client } from '../../models/client.model';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './client-form.component.html',
  styleUrl: './client-form.component.css'
})
export class ClientFormComponent implements OnInit {
  clientForm: FormGroup;
  private clientService = inject(ClientService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  
  isSubmitting = false;
  isEditMode = false;
  clientId: string | null = null;
  documentIdConflict = false;
  saveError: string | null = null;

  constructor(private fb: FormBuilder) {
    this.clientForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      documentId: ['', [Validators.required]],
      birthDate: [''],
      gender: [''],
      phone: ['', [Validators.required]],
      email: ['', [Validators.email]],
      address: [''],
      city: [''],
      occupation: [''],
      company: ['']
    });
  }

  async ngOnInit() {
    this.clientId = this.route.snapshot.paramMap.get('id');
    if (this.clientId) {
      this.isEditMode = true;
      const client = await this.clientService.getClientById(this.clientId);
      if (client) {
        this.clientForm.patchValue(client);
      }
    }
  }

  async onSubmit() {
    if (this.clientForm.valid) {
      this.isSubmitting = true;
      this.documentIdConflict = false;
      this.saveError = null;
      try {
        const documentId = String(this.clientForm.get('documentId')?.value ?? '').trim();
        if (await this.clientService.isDocumentIdInUse(documentId, this.isEditMode ? this.clientId || undefined : undefined)) {
          this.documentIdConflict = true;
          return;
        }
        if (this.isEditMode && this.clientId) {
          const updatedClient: Partial<Client> = { ...this.clientForm.value, documentId };
          await this.clientService.updateClient(this.clientId, updatedClient);
        } else {
          const newClient: Client = {
            ...this.clientForm.value,
            documentId,
            createdAt: new Date()
          };
          await this.clientService.addClient(newClient);
        }
        this.router.navigate(['/clients']);
      } catch (error: unknown) {
        console.error('Error saving document: ', error);
        this.saveError = error instanceof Error
          ? `No se pudo guardar el cliente: ${error.message}`
          : 'No se pudo guardar el cliente. Verifica la conexión e inténtalo de nuevo.';
      } finally {
        this.isSubmitting = false;
      }
    } else {
      this.clientForm.markAllAsTouched();
    }
  }
}
