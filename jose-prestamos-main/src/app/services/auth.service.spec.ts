import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    localStorage.clear();
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: Router, useValue: router }
      ]
    });
    service = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  it('assigns the cashier role and persists it after cashier login', () => {
    expect(service.login('cajaadmin', 'cajaadmin')).toBeTrue();
    expect(service.currentRole).toBe('cashier');
    expect(service.isCashier).toBeTrue();
    expect(service.isAdmin).toBeFalse();
    expect(localStorage.getItem('comosan_prest_user_role')).toBe('cashier');
  });

  it('keeps the administrator login separate from the cashier role', () => {
    expect(service.login('JoseAdmin', 'Admin1234')).toBeTrue();
    expect(service.currentRole).toBe('admin');
    expect(service.isAdmin).toBeTrue();
    expect(service.isCashier).toBeFalse();
  });

  it('rejects invalid credentials without authenticating', () => {
    expect(service.login('cajaadmin', 'wrong')).toBeFalse();
    expect(service.isAuthenticated()).toBeFalse();
  });

  it('clears the role on logout', () => {
    service.login('cajaadmin', 'cajaadmin');
    service.logout();
    expect(service.isAuthenticated()).toBeFalse();
    expect(localStorage.getItem('comosan_prest_user_role')).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('logs out after five minutes without activity', fakeAsync(() => {
    service.login('JoseAdmin', 'Admin1234');

    tick(5 * 60 * 1000 - 1);
    expect(service.isAuthenticated()).toBeTrue();

    tick(1);
    expect(service.isAuthenticated()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  }));

  it('resets the inactivity timeout when the user interacts', fakeAsync(() => {
    service.login('cajaadmin', 'cajaadmin');

    tick(4 * 60 * 1000);
    document.dispatchEvent(new Event('keydown'));
    tick(4 * 60 * 1000);
    expect(service.isAuthenticated()).toBeTrue();

    tick(60 * 1000);
    expect(service.isAuthenticated()).toBeFalse();
  }));
});
