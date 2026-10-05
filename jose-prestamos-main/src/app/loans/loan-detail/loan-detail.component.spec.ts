import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ClientService } from '../../services/client.service';
import { LoanService } from '../../services/loan.service';
import { PaymentReceiptService } from '../../services/payment-receipt.service';
import { LoanDetailComponent } from './loan-detail.component';

describe('LoanDetailComponent', () => {
  let component: LoanDetailComponent;
  let fixture: ComponentFixture<LoanDetailComponent>;
  let loanService: jasmine.SpyObj<LoanService>;
  let clientService: jasmine.SpyObj<ClientService>;
  let receiptService: jasmine.SpyObj<PaymentReceiptService>;

  beforeEach(async () => {
    loanService = jasmine.createSpyObj<LoanService>('LoanService', [
      'getLoans',
      'collectInstallment',
      'reverseInstallment'
    ]);
    loanService.getLoans.and.returnValue(of([]));
    clientService = jasmine.createSpyObj<ClientService>('ClientService', ['getClients']);
    clientService.getClients.and.returnValue(of([]));
    receiptService = jasmine.createSpyObj<PaymentReceiptService>('PaymentReceiptService', ['download', 'share']);
    receiptService.download.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [LoanDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'loan-1' })) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: LoanService, useValue: loanService },
        { provide: ClientService, useValue: clientService },
        { provide: AuthService, useValue: {
          isAdmin: true,
          isCashier: false,
          currentRole: 'admin',
          currentUsername: 'admin'
        } },
        { provide: PaymentReceiptService, useValue: receiptService }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LoanDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('requires confirmation before collecting and downloads a receipt after success', async () => {
    const receipt = {
      id: 'payment-1',
      loanId: 'loan-1',
      clientId: 'client-1',
      clientName: 'Cliente',
      amount: 250,
      type: 'installment' as const,
      collectedBy: 'admin',
      collectorRole: 'admin' as const,
      collectedAt: new Date()
    };
    loanService.collectInstallment.and.resolveTo(receipt);

    await component.toggleInstallmentStatus({
      id: 'loan-1',
      clientName: 'Cliente',
      clientPhone: '8095550101',
      installments: [{ amount: 250, paidAmount: 0, isPaid: false }]
    }, 0);

    expect(component.paymentConfirmation).toEqual({
      clientName: 'Cliente',
      loanId: 'loan-1',
      description: 'Cobrar cuota 1',
      amount: 250,
      paymentMethod: 'cash'
    });
    expect(loanService.collectInstallment).not.toHaveBeenCalled();

    await component.confirmPayment();

    expect(loanService.collectInstallment).toHaveBeenCalledOnceWith(
      'loan-1',
      0,
      250,
      { role: 'admin', username: 'admin' },
      'Cliente',
      'cash'
    );
    expect(component.lastReceipt?.id).toBe('payment-1');
    expect(component.lastReceipt?.clientPhone).toBe('8095550101');
    expect(receiptService.download).toHaveBeenCalledWith(component.lastReceipt!);
    expect(component.paymentConfirmation).toBeNull();
  });

  it('does not write a payment when confirmation is cancelled', async () => {
    await component.toggleInstallmentStatus({
      id: 'loan-1',
      clientName: 'Cliente',
      installments: [{ amount: 250, paidAmount: 0, isPaid: false }]
    }, 0);

    component.cancelPaymentConfirmation();

    expect(component.paymentConfirmation).toBeNull();
    expect(loanService.collectInstallment).not.toHaveBeenCalled();
  });
});
