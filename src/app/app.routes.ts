import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthShellComponent } from './layouts/auth-shell.component';
import { WorkspacePageComponent } from './layouts/workspace-page.component';
import { ConfirmResetPageComponent } from './pages/confirm-reset-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { RegisterPageComponent } from './pages/register-page.component';
import { ResetPasswordPageComponent } from './pages/reset-password-page.component';
import { ChillService } from './services/chill.service';

const requireAuthGuard: CanActivateFn = () => {
  const chill = inject(ChillService);
  if (chill.isAuthenticated()) {
    return true;
  }

  return inject(Router).createUrlTree(['/login']);
};

const guestOnlyGuard: CanActivateFn = () => {
  const chill = inject(ChillService);
  if (!chill.isAuthenticated()) {
    return true;
  }

  return inject(Router).createUrlTree(['/workspace', 'event-viewer']);
};

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login'
  },
  {
    path: '',
    component: AuthShellComponent,
    children: [
      { path: 'login', component: LoginPageComponent, canActivate: [guestOnlyGuard] },
      { path: 'register', component: RegisterPageComponent, canActivate: [guestOnlyGuard] },
      { path: 'reset-password', component: ResetPasswordPageComponent },
      { path: 'confirm-reset-password', component: ConfirmResetPageComponent },
      { path: 'confirm-reset-password/:token', component: ConfirmResetPageComponent }
    ]
  },
  { path: 'confirm-reset', pathMatch: 'full', redirectTo: 'confirm-reset-password' },
  { path: 'confirm-reset/:token', pathMatch: 'full', redirectTo: 'confirm-reset-password/:token' },
  { path: 'workspace', component: WorkspacePageComponent, canActivate: [requireAuthGuard] },
  { path: 'workspace/:taskId', component: WorkspacePageComponent, canActivate: [requireAuthGuard] },
  { path: '**', redirectTo: 'login' }
];
