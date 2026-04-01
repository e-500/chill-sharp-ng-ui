import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { ChillService } from '../services/chill.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  template: `
    <section class="auth-page">
      <div class="auth-card">
        <p class="eyebrow"><app-chill-i18n-label [labelGuid]="'A651A560-1828-4D67-8D60-8B97011231D7'" [primaryDefaultText]="'ChillSharp Auth'" [secondaryDefaultText]="'Autenticazione ChillSharp'" /></p>
        <h1><app-chill-i18n-label [labelGuid]="'0C4F53D0-2087-486B-9F2A-AEBCC226AF09'" [primaryDefaultText]="'Login'" [secondaryDefaultText]="'Accesso'" /></h1>
        <p class="lede"><app-chill-i18n-label [labelGuid]="'D22E0294-1500-4C13-9008-6980F84F2758'" [primaryDefaultText]="'Authenticate against the ChillSharp Identity endpoints through a single Angular service.'" [secondaryDefaultText]="'Autenticati agli endpoint Identity di ChillSharp tramite un singolo servizio Angular.'" /></p>

        @if (chill.isAuthenticated()) {
          <div class="notice success">
            {{ chill.T('F1F3C98A-655B-438A-BF7F-F730BF947EB0', 'Active session for', 'Sessione attiva per') }} <strong>{{ chill.userName() || chill.T('B0311DA4-F864-4E15-93A4-894D177F7017', 'current user', 'utente corrente') }}</strong>.
          </div>
        }

        <div class="notice" [class.success]="serviceStatusKind() === 'success'" [class.error]="serviceStatusKind() === 'error'">
          {{ serviceStatusMessage() }}
        </div>

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <label>
            <span><app-chill-i18n-label [labelGuid]="'EA8C79F7-B95E-40A8-B638-C09BFD355A94'" [primaryDefaultText]="'Username or email'" [secondaryDefaultText]="'Nome utente o email'" /></span>
            <input type="text" formControlName="userNameOrEmail" autocomplete="username" />
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'A76807CB-91F6-41A5-B565-D86EEA811241'" [primaryDefaultText]="'Password'" [secondaryDefaultText]="'Password'" /></span>
            <input type="password" formControlName="password" autocomplete="current-password" />
          </label>

          <button type="submit" [disabled]="isSubmitting() || form.invalid">
            @if (isSubmitting()) {
              <app-chill-i18n-button-label [labelGuid]="'8B825C06-0160-4B9F-B697-C624456C87CA'" [primaryDefaultText]="'Signing in...'" [secondaryDefaultText]="'Accesso in corso...'" />
            } @else {
              <app-chill-i18n-button-label [labelGuid]="'CA6A46A2-9E63-4AA8-849F-63EEB430A227'" [primaryDefaultText]="'Sign in'" [secondaryDefaultText]="'Accedi'" />
            }
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/register">{{ chill.T('61E5DBBB-413A-449B-BE0E-B4A991FA1E39', 'Create account', 'Crea account') }}</a>
          <a routerLink="/reset-password">{{ chill.T('E61B1755-5FB6-40ED-A8D2-B9158BF410D8', 'Forgot password', 'Password dimenticata') }}</a>
        </nav>
      </div>
    </section>
  `
})
export class LoginPageComponent implements OnInit {
  readonly chill = inject(ChillService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly serviceStatusMessage = signal(this.chill.T('A4AE0C28-6837-4586-B6D4-26FA90E7C458', 'Checking Chill service...', 'Verifica del servizio Chill in corso...'));
  readonly serviceStatusKind = signal<'info' | 'success' | 'error'>('info');
  readonly form = this.formBuilder.nonNullable.group({
    userNameOrEmail: ['', Validators.required],
    password: ['', Validators.required]
  });

  ngOnInit(): void {
    this.chill.test().subscribe({
      next: (response: string) => {
        this.serviceStatusKind.set('success');
        this.serviceStatusMessage.set(response || this.chill.T('C99B0A5B-433D-48DD-96D2-69D730A3EBCC', 'Chill service is available.', 'Il servizio Chill è disponibile.'));
      },
      error: (error: unknown) => {
        this.serviceStatusKind.set('error');
        this.serviceStatusMessage.set(`${this.chill.T('E271909F-89FE-4A7F-8763-A730FE770145', 'Chill service unavailable:', 'Servizio Chill non disponibile:')} ${this.chill.formatError(error)}`);
      }
    });
  }

  submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.chill.login({
      UserNameOrEmail: this.form.getRawValue().userNameOrEmail,
      Password: this.form.getRawValue().password
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        if (!this.chill.isAuthenticated()) {
          this.errorMessage.set(this.chill.T(
            '8995E23D-2E60-4D55-9E68-92BA746B9E16',
            'Login returned successfully, but no access token was persisted.',
            'Il login e riuscito, ma nessun token di accesso e stato salvato.'
          ));
          return;
        }
        void this.router.navigate(['/workspace', 'event-viewer']);
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
