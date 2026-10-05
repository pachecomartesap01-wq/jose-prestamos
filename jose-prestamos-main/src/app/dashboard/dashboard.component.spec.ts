import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { LoanService } from '../services/loan.service';
import { ClientService } from '../services/client.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let loanService: jasmine.SpyObj<LoanService>;
  let clientService: jasmine.SpyObj<ClientService>;
  let loans: Array<Record<string, unknown>>;

  beforeEach(async () => {
    loans = [{
      id: 'loan-1',
      clientId: 'client-1',
      amount: 100,
      interestRate: 10,
      duration: 1,
      paymentFrequency: 'monthly',
      startDate: { seconds: Date.parse('2025-04-15T12:00:00.000Z') / 1000 },
      status: 'active',
      installments: [{
        loanId: 'loan-1',
        dueDate: { seconds: Date.parse('2025-05-15T12:00:00.000Z') / 1000 },
        amount: 100,
        paidAmount: 25,
        isPaid: false
      }],
      capitalPayments: [{ date: new Date(), amount: 50 }]
    }];
    loanService = jasmine.createSpyObj<LoanService>('LoanService', [
      'getLoansSnapshot',
      'toDate',
      'isInterestOnly',
      'syncInterestOnlyInstallments',
      'expectedInterest'
    ]);
    loanService.getLoansSnapshot.and.returnValue(of({
      data: loans as never,
      fromCache: true,
      hasPendingWrites: false
    }));
    loanService.toDate.and.callFake(value => {
      if (typeof value === 'object' && value !== null && 'seconds' in value) {
        return new Date(Number(value.seconds) * 1000);
      }
      return value instanceof Date ? value : new Date(String(value));
    });
    loanService.isInterestOnly.and.returnValue(false);
    loanService.syncInterestOnlyInstallments.and.callFake(loan => loan.installments ?? []);
    loanService.expectedInterest.and.returnValue(10);

    clientService = jasmine.createSpyObj<ClientService>('ClientService', ['getClientsSnapshot']);
    clientService.getClientsSnapshot.and.returnValue(of({
      data: [{ id: 'client-1', name: 'Cliente Prueba' }] as never,
      fromCache: false,
      hasPendingWrites: false
    }));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: LoanService, useValue: loanService },
        { provide: ClientService, useValue: clientService }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('counts partial installment payments and capital prepayments in total recovered', async () => {
    expect(await firstValueFrom(component.totalRecuperado$)).toBe(75);
  });

  it('shows overdue unpaid installment balances separately', async () => {
    expect(await firstValueFrom(component.cuotasVencidas$)).toBe(1);
    expect(await firstValueFrom(component.saldoVencido$)).toBe(75);
  });

  it('normalizes timestamp dates and reports when data is still cached', async () => {
    const recentLoans = await firstValueFrom(component.prestamosRecientes$);
    const syncStatus = await firstValueFrom(component.syncStatus$);

    expect(recentLoans[0].displayStartDate?.toISOString()).toBe('2025-04-15T12:00:00.000Z');
    expect(recentLoans[0].clientName).toBe('Cliente Prueba');
    expect(syncStatus.fromCache).toBeTrue();
  });

  it('renders invalid legacy dates safely and flags the loan as incomplete', async () => {
    loans = [{
      id: 'legacy-loan',
      clientId: 'missing-client',
      amount: Number.NaN,
      interestRate: 0,
      duration: 1,
      paymentFrequency: 'monthly',
      startDate: 'not-a-date',
      status: 'active',
      installments: [{
        loanId: 'legacy-loan',
        dueDate: 'not-a-date',
        amount: 10,
        isPaid: false
      }]
    }];
    loanService.getLoansSnapshot.and.returnValue(of({
      data: loans as never,
      fromCache: false,
      hasPendingWrites: false
    }));
    fixture.destroy();
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const recentLoans = await firstValueFrom(component.prestamosRecientes$);
    const upcomingPayments = await firstValueFrom(component.proximosCobros$);

    expect(recentLoans[0].displayStartDate).toBeNull();
    expect(recentLoans[0].displayAmount).toBeNull();
    expect(recentLoans[0].dataIncomplete).toBeTrue();
    expect(upcomingPayments).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Sin fecha');
  });
});
