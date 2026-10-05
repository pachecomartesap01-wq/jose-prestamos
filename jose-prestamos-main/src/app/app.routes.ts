import { Routes } from '@angular/router';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ClientListComponent } from './clients/client-list/client-list.component';
import { ClientFormComponent } from './clients/client-form/client-form.component';
import { LoanListComponent } from './loans/loan-list/loan-list.component';
import { LoanFormComponent } from './loans/loan-form/loan-form.component';
import { LoanDetailComponent } from './loans/loan-detail/loan-detail.component';
// Alquileres: oculto temporalmente
// import { PropertyListComponent } from './properties/property-list/property-list.component';
// import { PropertyFormComponent } from './properties/property-form/property-form.component';
// import { PropertyDetailComponent } from './properties/property-detail/property-detail.component';
import { LoginComponent } from './login/login.component';
import { adminGuard, authGuard } from './guards/auth.guard';
import { PaymentHistoryComponent } from './payments/payment-history.component';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard, adminGuard] },
  { path: 'payment-history', component: PaymentHistoryComponent, canActivate: [authGuard, adminGuard] },
  { path: 'clients', component: ClientListComponent, canActivate: [authGuard] },
  { path: 'clients/new', component: ClientFormComponent, canActivate: [authGuard, adminGuard] },
  { path: 'clients/:id/edit', component: ClientFormComponent, canActivate: [authGuard, adminGuard] },
  { path: 'loans', component: LoanListComponent, canActivate: [authGuard] },
  { path: 'loans/new', component: LoanFormComponent, canActivate: [authGuard, adminGuard] },
  { path: 'loans/:id/edit', component: LoanFormComponent, canActivate: [authGuard, adminGuard] },
  { path: 'loans/:id', component: LoanDetailComponent, canActivate: [authGuard] },
  // Alquileres: oculto temporalmente. Para reactivarlo, descomentar estas rutas y los imports.
  // { path: 'properties', component: PropertyListComponent, canActivate: [authGuard] },
  // { path: 'properties/new', component: PropertyFormComponent, canActivate: [authGuard] },
  // { path: 'properties/:id/edit', component: PropertyFormComponent, canActivate: [authGuard] },
  // { path: 'properties/:id', component: PropertyDetailComponent, canActivate: [authGuard] }
  { path: 'properties', redirectTo: '/dashboard', pathMatch: 'prefix' },
  { path: '**', redirectTo: '/dashboard' }
];
