import { Routes } from '@angular/router';
import { ConfirmResetPageComponent } from './pages/confirm-reset-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { RegisterPageComponent } from './pages/register-page.component';
import { ResetPasswordPageComponent } from './pages/reset-password-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'reset-password', component: ResetPasswordPageComponent },
  { path: 'confirm-reset', component: ConfirmResetPageComponent },
  { path: '**', redirectTo: 'login' }
];
