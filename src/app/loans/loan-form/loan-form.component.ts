import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Loan, Installment } from '../../models/loan.model';
import { Client } from '../../models/client.model';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-loan-form',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './loan-form.component.html',
  styleUrl: './loan-form.component.css'
})
export class LoanFormComponent implements OnInit {
  loanForm: FormGroup;
  private loanService = inject(LoanService);
  private clientService = inject(ClientService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  
  clients$: Observable<Client[]> = this.clientService.getClients();
  isSubmitting = false;
  
  isPreviewMode = false;
  previewInstallments: Installment[] = [];
  previewLoan: Loan | null = null;
  selectedClientName = '';

  isEditMode = false;
  editLoanId: string | null = null;

  constructor(private fb: FormBuilder) {
    this.loanForm = this.fb.group({
      clientId: ['', [Validators.required]],
      amount: [0, [Validators.required, Validators.min(1)]],
      interestRate: [0, [Validators.required, Validators.min(0)]],
      duration: [1, [Validators.required, Validators.min(1)]],
      paymentFrequency: ['monthly', [Validators.required]],
      startDate: [new Date().toISOString().substring(0, 10), [Validators.required]]
    });
  }

  async ngOnInit() {
    this.editLoanId = this.route.snapshot.paramMap.get('id');
    if (this.editLoanId) {
      this.isEditMode = true;
      const loan = await this.loanService.getLoanById(this.editLoanId);
      if (loan) {
        let formattedDate = '';
        if (loan.startDate) {
          // Si es Timestamp de Firebase, convertirlo a fecha, luego a string YYYY-MM-DD
          const dateObj = (loan.startDate as any).toDate ? (loan.startDate as any).toDate() : new Date(loan.startDate);
          formattedDate = dateObj.toISOString().substring(0, 10);
        }

        this.loanForm.patchValue({
          clientId: loan.clientId,
          amount: loan.amount,
          interestRate: loan.interestRate,
          duration: loan.duration,
          paymentFrequency: loan.paymentFrequency,
          startDate: formattedDate
        });
      }
    }
  }

  onSubmit() {
    if (this.loanForm.valid) {
      const formValue = this.loanForm.value;
      this.previewLoan = {
        clientId: formValue.clientId,
        amount: Number(formValue.amount),
        interestRate: Number(formValue.interestRate),
        duration: Number(formValue.duration),
        paymentFrequency: formValue.paymentFrequency,
        startDate: new Date(formValue.startDate),
        status: 'active'
      };
      
      this.previewInstallments = this.loanService.calculateInstallments(
        this.previewLoan.amount,
        this.previewLoan.interestRate,
        this.previewLoan.duration,
        this.previewLoan.paymentFrequency,
        this.previewLoan.startDate
      );

      this.isPreviewMode = true;
    } else {
      this.loanForm.markAllAsTouched();
    }
  }

  cancelPreview() {
    this.isPreviewMode = false;
  }

  async confirmAndSave() {
    if (!this.previewLoan) return;
    
    if (this.isEditMode) {
      const confirmed = confirm('⚠️ ADVERTENCIA: Estás editando un préstamo existente.\n\nAl guardar, se reemplazará todo el calendario de pagos actual con estas nuevas cuotas. Se perderá permanentemente el historial de pagos realizados.\n\n¿Estás seguro de que deseas guardar los cambios?');
      if (!confirmed) return;
    }

    this.isSubmitting = true;
    try {
      this.previewLoan.installments = this.previewInstallments;
      
      if (this.isEditMode && this.editLoanId) {
        await this.loanService.updateLoan(this.editLoanId, this.previewLoan);
      } else {
        await this.loanService.createLoan(this.previewLoan);
      }
      this.router.navigate(['/loans']);
    } catch (error) {
      console.error('Error creating/updating loan: ', error);
      alert('Error al guardar el préstamo');
    } finally {
      this.isSubmitting = false;
    }
  }

  get loanSummary() {
    const amount = Number(this.loanForm.get('amount')?.value) || 0;
    const rate = Number(this.loanForm.get('interestRate')?.value) || 0;
    const duration = Number(this.loanForm.get('duration')?.value) || 1;
    const freq = this.loanForm.get('paymentFrequency')?.value || 'monthly';

    const totalInterest = amount * (rate / 100);
    const totalAmount = amount + totalInterest;
    const installmentAmount = duration > 0 ? totalAmount / duration : 0;

    let freqLabel = 'al mes';
    if (freq === 'daily') freqLabel = 'al día';
    else if (freq === 'weekly') freqLabel = 'a la semana';
    else if (freq === 'biweekly') freqLabel = 'cada 15 días';

    return {
      totalInterest,
      totalAmount,
      installmentAmount,
      freqLabel
    };
  }
}
