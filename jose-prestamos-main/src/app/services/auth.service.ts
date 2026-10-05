import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, distinctUntilChanged, map } from 'rxjs';

export type UserRole = 'admin' | 'cashier';

@Injectable({
  providedIn: 'root'
})
export class AuthService implements OnDestroy {
  private readonly ADMIN_USER = 'JoseAdmin';
  private readonly ADMIN_PASS = 'Admin1234';
  private readonly CASHIER_USER = 'cajaadmin';
  private readonly CASHIER_PASS = 'cajaadmin';
  private readonly AUTH_STORAGE_KEY = 'comosan_prest_auth_status';
  private readonly ROLE_STORAGE_KEY = 'comosan_prest_user_role';
  private readonly LAST_ACTIVITY_STORAGE_KEY = 'comosan_prest_last_activity';
  private readonly INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
  private activityTimeout?: ReturnType<typeof setTimeout>;
  private lastSharedActivityAt = 0;
  private readonly activityEvents = ['click', 'keydown', 'mousemove', 'mousedown', 'scroll', 'touchstart', 'pointerdown'];
  private readonly handleActivity = (): void => {
    if (!this.isAuthenticated()) return;

    const now = Date.now();
    if (now - this.lastSharedActivityAt >= 1000) {
      localStorage.setItem(this.LAST_ACTIVITY_STORAGE_KEY, String(now));
      this.lastSharedActivityAt = now;
    }
    this.scheduleInactivityLogout(now);
  };
  private readonly handleStorage = (event: StorageEvent): void => {
    if (event.key === this.AUTH_STORAGE_KEY && event.newValue !== 'true') {
      this.clearInactivityTimeout();
      this.roleSubject.next(null);
      this.router.navigate(['/login']);
      return;
    }

    if (event.key === this.ROLE_STORAGE_KEY && localStorage.getItem(this.AUTH_STORAGE_KEY) === 'true') {
      const role = event.newValue === 'cashier' ? 'cashier' : 'admin';
      this.roleSubject.next(role);
    }

    if (event.key === this.LAST_ACTIVITY_STORAGE_KEY && this.isAuthenticated()) {
      const lastActivity = Number(event.newValue);
      if (Number.isFinite(lastActivity)) this.scheduleInactivityLogout(lastActivity);
    }
  };

  private roleSubject = new BehaviorSubject<UserRole | null>(this.checkInitialRole());
  public authStatus$ = this.roleSubject.pipe(
    map(role => role !== null),
    distinctUntilChanged()
  );

  constructor(private router: Router) {
    this.initializeInactivityHandling();
  }

  ngOnDestroy(): void {
    this.clearInactivityTimeout();
    if (typeof document !== 'undefined') {
      this.activityEvents.forEach(event => document.removeEventListener(event, this.handleActivity));
    }
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.handleStorage);
  }

  private initializeInactivityHandling(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    this.activityEvents.forEach(event => document.addEventListener(event, this.handleActivity, { passive: true }));
    window.addEventListener('storage', this.handleStorage);

    if (!this.isAuthenticated()) return;
    const lastActivity = Number(localStorage.getItem(this.LAST_ACTIVITY_STORAGE_KEY));
    const activityAt = Number.isFinite(lastActivity) && lastActivity > 0 ? lastActivity : Date.now();
    if (!Number.isFinite(lastActivity) || lastActivity <= 0) {
      localStorage.setItem(this.LAST_ACTIVITY_STORAGE_KEY, String(activityAt));
    }
    this.lastSharedActivityAt = activityAt;
    this.scheduleInactivityLogout(activityAt);
  }

  private scheduleInactivityLogout(lastActivityAt: number): void {
    this.clearInactivityTimeout();
    const elapsed = Date.now() - lastActivityAt;
    const remaining = this.INACTIVITY_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      this.logout();
      return;
    }
    this.activityTimeout = setTimeout(() => {
      const latestActivity = Number(localStorage.getItem(this.LAST_ACTIVITY_STORAGE_KEY));
      if (Number.isFinite(latestActivity) && latestActivity > lastActivityAt) {
        this.scheduleInactivityLogout(latestActivity);
      } else {
        this.logout();
      }
    }, remaining);
  }

  private clearInactivityTimeout(): void {
    if (this.activityTimeout !== undefined) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = undefined;
    }
  }

  private checkInitialRole(): UserRole | null {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem(this.AUTH_STORAGE_KEY) !== 'true') return null;
      return localStorage.getItem(this.ROLE_STORAGE_KEY) === 'cashier' ? 'cashier' : 'admin';
    }
    return null;
  }

  isAuthenticated(): boolean {
    return this.roleSubject.value !== null;
  }

  login(user: string, pass: string): boolean {
    const normalizedUser = user.trim();
    const role = normalizedUser === this.CASHIER_USER && pass === this.CASHIER_PASS
      ? 'cashier'
      : normalizedUser === this.ADMIN_USER && pass === this.ADMIN_PASS
        ? 'admin'
        : null;

    if (role) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.AUTH_STORAGE_KEY, 'true');
        localStorage.setItem(this.ROLE_STORAGE_KEY, role);
        const now = Date.now();
        localStorage.setItem(this.LAST_ACTIVITY_STORAGE_KEY, String(now));
        this.lastSharedActivityAt = now;
      }
      this.roleSubject.next(role);
      if (typeof document !== 'undefined') this.handleActivity();
      return true;
    }
    return false;
  }

  get currentRole(): UserRole | null {
    return this.roleSubject.value;
  }

  get currentUsername(): string | null {
    if (this.isCashier) return this.CASHIER_USER;
    if (this.isAdmin) return this.ADMIN_USER;
    return null;
  }

  get isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

  get isCashier(): boolean {
    return this.currentRole === 'cashier';
  }

  logout() {
    this.clearInactivityTimeout();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.AUTH_STORAGE_KEY);
      localStorage.removeItem(this.ROLE_STORAGE_KEY);
      localStorage.removeItem(this.LAST_ACTIVITY_STORAGE_KEY);
    }
    this.roleSubject.next(null);
    this.router.navigate(['/login']);
  }
}
