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
        <p class="eyebrow">ChillSharp Auth</p>
        <h1>Reset password</h1>
        <p class="lede">Request a password-reset token through the ChillSharp auth reset endpoint.</p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <label>
            <span>Username or email</span>
            <input type="text" formControlName="userNameOrEmail" autocomplete="username" />
          </label>

          <button type="submit" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting() ? 'Requesting...' : 'Request reset token' }}
          </button>
        </form>

        @if (response()) {
          <div class="token-panel">
            <p class="token-title">Reset response</p>
            <dl>
              <div>
                <dt>Accepted</dt>
                <dd>{{ response()?.IsAccepted ? 'Yes' : 'No' }}</dd>
              </div>
              <div>
                <dt>User ID</dt>
                <dd>{{ response()?.UserId || 'Not returned by the server' }}</dd>
              </div>
              <div>
                <dt>Reset token</dt>
                <dd class="wrap">{{ response()?.ResetToken || 'Not returned by the server' }}</dd>
              </div>
            </dl>

            @if (response()?.UserId && response()?.ResetToken) {
              <a
                class="button-link"
                [routerLink]="['/confirm-reset']"
                [queryParams]="{ userId: response()?.UserId, token: response()?.ResetToken }">
                Continue to confirmation
              </a>
            }
          </div>
        }

        <nav class="auth-links">
          <a routerLink="/login">Back to login</a>
          <a routerLink="/register">Create account</a>
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
        this.successMessage.set('Reset request accepted by the ChillSharp auth endpoint.');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
