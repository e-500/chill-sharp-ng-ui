import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { ConfirmResetPageComponent } from './pages/confirm-reset-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { EventViewerComponent } from './pages/atlas/event-viewer/event-viewer.component';
import { CrudPageComponent } from './pages/crud/crud-page.component';
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

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: LoginPageComponent },
  { path: 'register', component: RegisterPageComponent },
  { path: 'reset-password', component: ResetPasswordPageComponent },
  { path: 'confirm-reset', component: ConfirmResetPageComponent },
  { path: 'crud', component: CrudPageComponent, canActivate: [requireAuthGuard] },
  { path: 'atlas/event-viewer', component: EventViewerComponent, canActivate: [requireAuthGuard] },
  { path: '**', redirectTo: 'login' }
];
