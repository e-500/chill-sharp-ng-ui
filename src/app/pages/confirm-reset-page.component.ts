import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChillService } from '../services/chill.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-confirm-reset-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <div class="auth-card wide">
        <p class="eyebrow">ChillSharp Auth</p>
        <h1>Confirm reset</h1>
        <p class="lede">Submit the \`UserId\`, \`ResetToken\`, and new password to complete the ChillSharp reset flow.</p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form two-columns">
          <label class="full-width">
            <span>User ID</span>
            <input type="text" formControlName="userId" />
          </label>

          <label class="full-width">
            <span>Reset token</span>
            <textarea rows="5" formControlName="resetToken"></textarea>
          </label>

          <label>
            <span>New password</span>
            <input type="password" formControlName="newPassword" autocomplete="new-password" />
          </label>

          <label>
            <span>Confirm password</span>
            <input type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </label>

          @if (form.hasError('passwordMismatch') && form.touched) {
            <div class="notice error full-width">Password confirmation does not match.</div>
          }

          <button type="submit" class="full-width" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting() ? 'Applying reset...' : 'Confirm reset' }}
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/reset-password">Request token again</a>
          <a routerLink="/login">Back to login</a>
        </nav>
      </div>
    </section>
  `
})
export class ConfirmResetPageComponent {
  readonly chill = inject(ChillService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    userId: [this.route.snapshot.queryParamMap.get('userId') ?? '', Validators.required],
    resetToken: [this.route.snapshot.queryParamMap.get('token') ?? '', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required, Validators.minLength(6)]]
  }, { validators: passwordMatchValidator });

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const value = this.form.getRawValue();
    this.chill.confirmPasswordReset({
      UserId: value.userId,
      ResetToken: value.resetToken,
      NewPassword: value.newPassword
    }).subscribe({
      next: (response: { Succeeded?: boolean }) => {
        this.isSubmitting.set(false);
        if (!response.Succeeded) {
          this.errorMessage.set('Password reset was rejected by the server.');
          return;
        }

        this.successMessage.set('Password updated successfully. Redirecting to login...');
        setTimeout(() => {
          void this.router.navigateByUrl('/login');
        }, 900);
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
