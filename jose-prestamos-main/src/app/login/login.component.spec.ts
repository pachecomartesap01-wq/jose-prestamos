import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: AuthService, useValue: { login: jasmine.createSpy('login'), isCashier: false } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  });

  it('toggles password visibility accessibly', () => {
    const password = fixture.nativeElement.querySelector('#password') as HTMLInputElement;
    const toggle = fixture.nativeElement.querySelector('[aria-label="Mostrar contraseña"]') as HTMLButtonElement;

    expect(password.type).toBe('password');
    toggle.click();
    fixture.detectChanges();

    expect(password.type).toBe('text');
    expect(fixture.nativeElement.querySelector('[aria-label="Ocultar contraseña"]')).toBeTruthy();

    (fixture.nativeElement.querySelector('[aria-label="Ocultar contraseña"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(password.type).toBe('password');
  });
});
