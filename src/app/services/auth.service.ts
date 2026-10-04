import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly ADMIN_USER = 'JoseAdmin';
  private readonly ADMIN_PASS = 'Admin1234';
  private readonly STORAGE_KEY = 'comosan_prest_auth_status';

  private authStatusSubject = new BehaviorSubject<boolean>(this.checkInitialAuth());
  public authStatus$ = this.authStatusSubject.asObservable();

  constructor(private router: Router) {}

  private checkInitialAuth(): boolean {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(this.STORAGE_KEY) === 'true';
    }
    return false;
  }

  isAuthenticated(): boolean {
    return this.authStatusSubject.value;
  }

  login(user: string, pass: string): boolean {
    if (user === this.ADMIN_USER && pass === this.ADMIN_PASS) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.STORAGE_KEY, 'true');
      }
      this.authStatusSubject.next(true);
      return true;
    }
    return false;
  }

  logout() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
    this.authStatusSubject.next(false);
    this.router.navigate(['/login']);
  }
}
