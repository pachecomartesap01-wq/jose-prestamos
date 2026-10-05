import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LoanService } from '../../services/loan.service';
import { ClientService } from '../../services/client.service';
import { Loan, Installment, LoanType, InterestMethod, InterestPeriod, PaymentFrequency } from '../../models/loan.model';
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
  loanService = inject(LoanService);
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
  isEditingLoanWithPayments = false;
  editSafetyCheckFailed = false;
  /** Préstamos antiguos guardados con tasa "sobre el total". */
  isLegacyLoan = false;

  constructor(private fb: FormBuilder) {
    this.loanForm = this.fb.group({
      clientId: ['', [Validators.required]],
      loanType: ['amortized' as LoanType, [Validators.required]],
      amount: [0, [Validators.required, Validators.min(1)]],
      interestRate: [0, [Validators.required, Validators.min(0)]],
      interestPeriod: ['monthly' as InterestPeriod, [Validators.required]],
      interestMethod: ['reducing_balance' as InterestMethod, [Validators.required]],
      duration: [1, [Validators.required, Validators.min(1)]],
      paymentFrequency: ['monthly' as PaymentFrequency, [Validators.required]],
      startDate: [this.toInputDate(new Date()), [Validators.required]]
    });
  }

  get isInterestOnly(): boolean {
    return this.loanForm.get('loanType')?.value === 'interest_only';
  }

  setLoanType(type: LoanType) {
    this.loanForm.get('loanType')?.setValue(type);
  }

  async ngOnInit() {
    this.editLoanId = this.route.snapshot.paramMap.get('id');
    if (this.editLoanId) {
      this.isEditMode = true;
      const loan = await this.loanService.getLoanById(this.editLoanId);
      if (loan) {
        const formattedDate = loan.startDate ? this.toInputDate(this.loanService.toDate(loan.startDate)) : '';
        this.isLegacyLoan = this.loanService.isLegacyRate(loan);

        this.loanForm.patchValue({
          clientId: loan.clientId,
          loanType: loan.loanType || 'amortized',
          amount: loan.amount,
          interestRate: loan.interestRate,
          interestPeriod: loan.interestPeriod || 'total',
          interestMethod: loan.interestMethod || 'flat',
          duration: loan.duration || 1,
          paymentFrequency: loan.paymentFrequency,
          startDate: formattedDate
        });
        this.isEditingLoanWithPayments = Boolean(
          loan.installments?.some(installment => installment.isPaid || (installment.paidAmount || 0) > 0) ||
          loan.capitalPayments?.length ||
          loan.status !== 'active'
        );
        try {
          this.isEditingLoanWithPayments ||= await this.loanService.hasPaymentHistoryForLoan(this.editLoanId);
        } catch (error) {
          console.error('No se pudo verificar el historial del préstamo antes de editar', error);
          this.editSafetyCheckFailed = true;
        }
      }
    }
  }

  /** Fecha local -> 'YYYY-MM-DD' (sin desfase por zona horaria). */
  private toInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** 'YYYY-MM-DD' -> fecha local a medianoche (new Date('YYYY-MM-DD') la interpreta en UTC). */
  private fromInputDate(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private buildLoanFromForm(): Loan {
    const v = this.loanForm.value;
    const loanType: LoanType = v.loanType;
    const amount = Number(v.amount);
    const loan: Loan = {
      clientId: v.clientId,
      loanType,
      amount,
      interestRate: Number(v.interestRate),
      interestPeriod: v.interestPeriod,
      interestMethod: v.interestMethod,
      duration: loanType === 'interest_only' ? 0 : Number(v.duration),
      paymentFrequency: v.paymentFrequency,
      startDate: this.fromInputDate(v.startDate),
      status: 'active'
    };
    if (loanType === 'interest_only') {
      loan.principalBalance = amount;
      loan.capitalPayments = [];
    }
    return loan;
  }

  onSubmit() {
    if (this.loanForm.valid) {
      this.previewLoan = this.buildLoanFromForm();
      this.previewInstallments = this.loanService.calculateInstallments(this.previewLoan);
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
      if (this.editSafetyCheckFailed) {
        alert('No se pudo verificar el historial de pagos en el servidor. Conéctate e inténtalo de nuevo antes de editar el préstamo.');
        return;
      }
      if (this.isEditingLoanWithPayments) {
        alert('Este préstamo ya tiene pagos registrados y no se puede recalcular sin perder su historial. Registra un nuevo préstamo para refinanciarlo.');
        return;
      }
      const confirmed = confirm('Al guardar se actualizarán las condiciones y el calendario de cuotas de este préstamo. ¿Deseas continuar?');
      if (!confirmed) return;
    }

    this.isSubmitting = true;
    try {
      this.previewLoan.installments = this.previewInstallments;
      
      if (this.isEditMode && this.editLoanId) {
        // Al editar se reinicia el capital pendiente y el historial de abonos
        const data: any = { ...this.previewLoan };
        if (this.previewLoan.loanType !== 'interest_only') {
          data.principalBalance = null;
          data.capitalPayments = null;
        }
        await this.loanService.updateLoan(this.editLoanId, data);
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
    const freq: PaymentFrequency = this.loanForm.get('paymentFrequency')?.value || 'monthly';
    const period: InterestPeriod = this.loanForm.get('interestPeriod')?.value || 'monthly';

    const ratePerPayment = this.loanService.ratePerPayment(rate, period, freq) * 100;

    let freqLabel = 'al mes';
    if (freq === 'daily') freqLabel = 'al día';
    else if (freq === 'weekly') freqLabel = 'a la semana';
    else if (freq === 'biweekly') freqLabel = 'cada 15 días';

    if (this.isInterestOnly) {
      const installmentAmount = this.loanService.interestOnlyPayment(amount, { interestRate: rate, interestPeriod: period, paymentFrequency: freq });
      return {
        totalInterest: installmentAmount,
        totalAmount: amount,
        installmentAmount,
        ratePerPayment,
        freqLabel
      };
    }

    const interestMethod: InterestMethod = this.loanForm.get('interestMethod')?.value || 'flat';
    const previewInstallments = this.loanService.calculateInstallments({
      amount,
      interestRate: rate,
      interestPeriod: period,
      interestMethod,
      duration,
      paymentFrequency: freq,
      startDate: this.fromInputDate(this.loanForm.get('startDate')?.value || this.toInputDate(new Date())),
      clientId: '',
      status: 'active'
    });
    const totalInterest = interestMethod === 'reducing_balance'
      ? previewInstallments.reduce((sum, installment) => sum + (installment.interestAmount || 0), 0)
      : this.loanService.amortizedTotalInterest({ amount, interestRate: rate, interestPeriod: period, duration, paymentFrequency: freq, interestMethod });
    const totalAmount = amount + totalInterest;
    const installmentAmount = previewInstallments[0]?.amount ?? 0;
    const finalInstallmentAmount = previewInstallments[previewInstallments.length - 1]?.amount ?? 0;

    return {
      totalInterest,
      totalAmount,
      installmentAmount,
      finalInstallmentAmount,
      ratePerPayment,
      freqLabel
    };
  }
}
