import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PasswordResetTokenResponse } from '../models/chill-auth.models';
import { ChillService } from '../services/chill.service';

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <div class="auth-card">
        <p class="eyebrow">{{ chill.T('A651A560-1828-4D67-8D60-8B97011231D7', 'ChillSharp Auth', 'Autenticazione ChillSharp') }}</p>
        <h1>{{ chill.T('1322FAE4-DBD5-4C8D-8988-FA6035551E02', 'Reset password', 'Reimposta password') }}</h1>
        <p class="lede">{{ chill.T('6F70BF2E-01D1-4102-A544-2B22CF54C2EA', 'Request a password-reset token through the ChillSharp auth reset endpoint.', "Richiedi un token di reimpostazione password tramite l\'endpoint auth di reset di ChillSharp.") }}</p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <label>
            <span>{{ chill.T('EA8C79F7-B95E-40A8-B638-C09BFD355A94', 'Username or email', 'Nome utente o email') }}</span>
            <input type="text" formControlName="userNameOrEmail" autocomplete="username" />
          </label>

          <button type="submit" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting()
              ? chill.T('33346EC7-C16F-4E58-A24E-097534F42BBE', 'Requesting...', 'Richiesta in corso...')
              : chill.T('6E44886E-EA78-4749-AABF-53E1BE8022D8', 'Request reset token', 'Richiedi token di reset') }}
          </button>
        </form>

        @if (response()) {
          <div class="token-panel">
            <p class="token-title">{{ chill.T('DCCDB0A2-80BA-465D-8D96-8A5FF9A0179D', 'Reset response', 'Risposta reset') }}</p>
            <dl>
              <div>
                <dt>{{ chill.T('970FE371-F8CB-4C64-9DFE-7F72241D8D9A', 'Accepted', 'Accettato') }}</dt>
                <dd>{{ response()?.IsAccepted
                  ? chill.T('E7FE0A44-0957-453A-A2AA-4F08FD38D8E1', 'Yes', 'Sì')
                  : chill.T('27EC1CA2-5AAA-4A14-B89A-9E4317349917', 'No', 'No') }}</dd>
              </div>
              <div>
                <dt>{{ chill.T('CEB1B59C-FD4E-46D4-B11C-F8B33EA4C32E', 'User ID', 'ID utente') }}</dt>
                <dd>{{ response()?.UserId || chill.T('6D5C3326-1F96-434A-B6EC-0E72C5A79A0F', 'Not returned by the server', 'Non restituito dal server') }}</dd>
              </div>
              <div>
                <dt>{{ chill.T('3D525E29-B464-49FF-AC72-6D7E05D0F226', 'Reset token', 'Token di reset') }}</dt>
                <dd class="wrap">{{ response()?.ResetToken || chill.T('6D5C3326-1F96-434A-B6EC-0E72C5A79A0F', 'Not returned by the server', 'Non restituito dal server') }}</dd>
              </div>
            </dl>

            @if (response()?.UserId && response()?.ResetToken) {
              <a
                class="button-link"
                [routerLink]="['/confirm-reset']"
                [queryParams]="{ userId: response()?.UserId, token: response()?.ResetToken }">
                {{ chill.T('8FA3C95A-E55C-40F4-BFF7-E712A11EEB22', 'Continue to confirmation', 'Continua alla conferma') }}
              </a>
            }
          </div>
        }

        <nav class="auth-links">
          <a routerLink="/login">{{ chill.T('1919121D-A2BC-403E-8FCA-E120630A1FAC', 'Back to login', 'Torna al login') }}</a>
          <a routerLink="/register">{{ chill.T('61E5DBBB-413A-449B-BE0E-B4A991FA1E39', 'Create account', 'Crea account') }}</a>
        </nav>
      </div>
    </section>
  `
})
export class ResetPasswordPageComponent {
  readonly chill = inject(ChillService);
  private readonly formBuilder = inject(FormBuilder);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly response = signal<PasswordResetTokenResponse | null>(null);
  readonly form = this.formBuilder.nonNullable.group({
    userNameOrEmail: ['', Validators.required]
  });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.response.set(null);

    this.chill.requestPasswordReset({
      UserNameOrEmail: this.form.getRawValue().userNameOrEmail
    }).subscribe({
      next: (response: PasswordResetTokenResponse) => {
        this.isSubmitting.set(false);
        this.response.set(response);
        this.successMessage.set(this.chill.T('0C3066C3-C623-4895-8C0A-28DAB44AF6A1', 'Reset request accepted by the ChillSharp auth endpoint.', 'Richiesta di reset accettata dall\'endpoint auth di ChillSharp.'));
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
