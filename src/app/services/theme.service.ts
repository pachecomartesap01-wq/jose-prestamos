import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private isDarkSubject = new BehaviorSubject<boolean>(false);
  isDark$ = this.isDarkSubject.asObservable();

  constructor() {
    this.initTheme();
  }

  private initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      this.setDarkTheme(true);
    } else {
      this.setDarkTheme(false);
    }
  }

  toggleTheme() {
    this.setDarkTheme(!this.isDarkSubject.value);
  }

  private setDarkTheme(isDark: boolean) {
    this.isDarkSubject.next(isDark);
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }
}
