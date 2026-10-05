import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { LoanService } from './loan.service';

describe('LoanService', () => {
  let service: LoanService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        LoanService,
        { provide: Firestore, useValue: {} }
      ]
    });
    service = TestBed.inject(LoanService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('normalizes Firestore timestamp objects and serialized timestamp values', () => {
    const timestampDate = new Date('2025-04-15T12:00:00.000Z');
    const fromSdk = service.toDate({ toDate: () => timestampDate });
    const serialized = service.toDate({ seconds: timestampDate.getTime() / 1000, nanoseconds: 0 });
    const legacySerialized = service.toDate({ _seconds: timestampDate.getTime() / 1000 });

    expect(fromSdk.getTime()).toBe(timestampDate.getTime());
    expect(serialized.getTime()).toBe(timestampDate.getTime());
    expect(legacySerialized.getTime()).toBe(timestampDate.getTime());
  });

  it('returns an invalid date for malformed values rather than throwing', () => {
    expect(Number.isNaN(service.toDate({ seconds: 'invalid' }).getTime())).toBeTrue();
    expect(Number.isNaN(service.toDate(undefined).getTime())).toBeTrue();
  });

  it('calculates declining-balance installments in cents and clears the principal', () => {
    const installments = service.calculateInstallments({
      clientId: 'client-1',
      amount: 1200,
      interestRate: 12,
      interestPeriod: 'annual',
      interestMethod: 'reducing_balance',
      duration: 12,
      paymentFrequency: 'monthly',
      startDate: new Date(2026, 0, 1),
      status: 'active'
    });

    expect(installments.length).toBe(12);
    expect(installments[0].amount).toBe(106.62);
    expect(installments[0].interestAmount).toBe(12);
    expect(installments[0].principalAmount).toBe(94.62);
    expect(installments[11].amount).toBe(106.6);
    expect(installments.reduce((sum, installment) => sum + (installment.principalAmount || 0), 0)).toBe(1200);
    expect(service.amortizedTotalInterest({
      amount: 1200,
      interestRate: 12,
      interestPeriod: 'annual',
      interestMethod: 'reducing_balance',
      duration: 12,
      paymentFrequency: 'monthly'
    })).toBeCloseTo(79.42, 2);
  });

  it('preserves the flat-interest calculation for existing loans without an interest method', () => {
    const installments = service.calculateInstallments({
      clientId: 'client-1',
      amount: 1200,
      interestRate: 12,
      interestPeriod: 'annual',
      duration: 12,
      paymentFrequency: 'monthly',
      startDate: new Date(2026, 0, 1),
      status: 'active'
    });

    expect(installments[0].amount).toBe(112);
    expect(installments.every(installment => installment.interestAmount === undefined)).toBeTrue();
  });

  it('subtracts received principal when calculating the outstanding amortized balance', () => {
    const balance = service.amortizedOutstandingPrincipal({
      id: 'loan-1',
      clientId: 'client-1',
      amount: 1200,
      interestRate: 12,
      interestPeriod: 'annual',
      interestMethod: 'reducing_balance',
      duration: 2,
      paymentFrequency: 'monthly',
      startDate: new Date(2026, 0, 1),
      status: 'active',
      installments: [
        {
          loanId: 'loan-1',
          dueDate: new Date(2026, 1, 1),
          amount: 600,
          isPaid: false,
          principalAmount: 500,
          interestAmount: 100,
          paidAmount: 150,
          paidPrincipalAmount: 50,
          paidInterestAmount: 100
        },
        {
          loanId: 'loan-1',
          dueDate: new Date(2026, 2, 1),
          amount: 600,
          isPaid: false,
          principalAmount: 700,
          interestAmount: 0
        }
      ]
    });

    expect(balance).toBe(1150);
  });
});
