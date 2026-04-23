import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { NoticeTransitionDirective } from '../lib/notice-transition.directive';
import { ChillService } from '../services/chill.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-confirm-reset-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ChillI18nLabelComponent, ChillI18nButtonLabelComponent, NoticeTransitionDirective],
  template: `
    <section class="auth-page">
      <div class="auth-card wide">
        <p class="eyebrow"><app-chill-i18n-label [labelGuid]="'A651A560-1828-4D67-8D60-8B97011231D7'" [primaryDefaultText]="'ChillSharp Auth'" [secondaryDefaultText]="'Autenticazione ChillSharp'" /></p>
        <h1><app-chill-i18n-label [labelGuid]="'5346E633-5DF8-4A90-8349-7D5622312A84'" [primaryDefaultText]="'Confirm reset'" [secondaryDefaultText]="'Conferma reimpostazione'" /></h1>
        <p class="lede"><app-chill-i18n-label [labelGuid]="'A97AAEAA-92FA-4F47-B7DD-D84824ECE053'" [primaryDefaultText]="'Submit the UserId, ResetToken, and new password to complete the ChillSharp reset flow.'" [secondaryDefaultText]="'Invia UserId, ResetToken e la nuova password per completare il flusso di reset di ChillSharp.'" /></p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form two-columns">
          <label class="full-width">
            <span><app-chill-i18n-label [labelGuid]="'CEB1B59C-FD4E-46D4-B11C-F8B33EA4C32E'" [primaryDefaultText]="'User ID'" [secondaryDefaultText]="'ID utente'" /></span>
            <input type="text" formControlName="userId" />
          </label>

          <label class="full-width">
            <span><app-chill-i18n-label [labelGuid]="'3D525E29-B464-49FF-AC72-6D7E05D0F226'" [primaryDefaultText]="'Reset token'" [secondaryDefaultText]="'Token di reset'" /></span>
            <textarea rows="5" formControlName="resetToken"></textarea>
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'7B9AA727-6032-47E3-917E-EBA35C9C264F'" [primaryDefaultText]="'New password'" [secondaryDefaultText]="'Nuova password'" /></span>
            <input type="password" formControlName="newPassword" autocomplete="new-password" />
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'14EB51FA-9D9B-427C-AFD6-CC54031B9B26'" [primaryDefaultText]="'Confirm password'" [secondaryDefaultText]="'Conferma password'" /></span>
            <input type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </label>

          @if (form.hasError('passwordMismatch') && form.touched) {
            <div class="notice error full-width">{{ chill.T('12632967-9A9B-4A16-B7DF-D64B7BA7914A', 'Password confirmation does not match.', 'La conferma della password non corrisponde.') }}</div>
          }

          <button type="submit" class="full-width" [disabled]="isSubmitting() || form.invalid">
            @if (isSubmitting()) {
              <app-chill-i18n-button-label [labelGuid]="'34936727-D552-4649-A178-3377D418D5B6'" [primaryDefaultText]="'Applying reset...'" [secondaryDefaultText]="'Applicazione reset in corso...'" />
            } @else {
              <app-chill-i18n-button-label [labelGuid]="'5346E633-5DF8-4A90-8349-7D5622312A84'" [primaryDefaultText]="'Confirm reset'" [secondaryDefaultText]="'Conferma reimpostazione'" />
            }
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/reset-password">{{ chill.T('D5B5D31E-1F31-4080-A628-0674B00ECF07', 'Request token again', 'Richiedi di nuovo il token') }}</a>
          <a routerLink="/login">{{ chill.T('1919121D-A2BC-403E-8FCA-E120630A1FAC', 'Back to login', 'Torna al login') }}</a>
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
    resetToken: [this.route.snapshot.paramMap.get('token') ?? this.route.snapshot.queryParamMap.get('token') ?? '', Validators.required],
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
          this.errorMessage.set(this.chill.T('42917D4F-BE30-4D5C-9428-EC231D485C11', 'Password reset was rejected by the server.', 'La reimpostazione della password è stata rifiutata dal server.'));
          return;
        }

        this.successMessage.set(this.chill.T('2B08DE64-CF1B-467A-A355-F541B8485D7E', 'Password updated successfully. Redirecting to login...', 'Password aggiornata correttamente. Reindirizzamento al login...'));
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
