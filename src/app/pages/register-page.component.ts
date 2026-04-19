import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { CHILL_CULTURE } from '../chill.config';
import { ChillService } from '../services/chill.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  template: `
    <section class="auth-page">
      <div class="auth-card wide">
        <p class="eyebrow"><app-chill-i18n-label [labelGuid]="'A651A560-1828-4D67-8D60-8B97011231D7'" [primaryDefaultText]="'ChillSharp Auth'" [secondaryDefaultText]="'Autenticazione ChillSharp'" /></p>
        <h1><app-chill-i18n-label [labelGuid]="'0A777B5C-F7D1-4084-B32F-D5162E100AF6'" [primaryDefaultText]="'Register'" [secondaryDefaultText]="'Registrazione'" /></h1>
        <p class="lede"><app-chill-i18n-label [labelGuid]="'E4AB90A6-DB4D-4D34-BA80-8D07F6F5595D'" [primaryDefaultText]="'Create an ASP.NET Core Identity account and optionally the linked ChillSharp auth user.'" [secondaryDefaultText]="&quot;Crea un account ASP.NET Core Identity e, facoltativamente, l'utente auth collegato di ChillSharp.&quot;" /></p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form two-columns">
          <label>
            <span><app-chill-i18n-label [labelGuid]="'2AF5EB08-932E-4D4D-9338-75E1808B5F16'" [primaryDefaultText]="'Username'" [secondaryDefaultText]="'Nome utente'" /></span>
            <input type="text" formControlName="userName" autocomplete="username" />
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'311C8595-76C7-41DF-B4A0-0D0EF8E9A3D7'" [primaryDefaultText]="'Email'" [secondaryDefaultText]="'Email'" /></span>
            <input type="email" formControlName="email" autocomplete="email" />
          </label>

          <label class="full-width">
            <span><app-chill-i18n-label [labelGuid]="'C0D8A063-E084-460D-BF83-BCE32CB68588'" [primaryDefaultText]="'Display name'" [secondaryDefaultText]="'Nome visualizzato'" /></span>
            <input type="text" formControlName="displayName" autocomplete="name" />
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'A76807CB-91F6-41A5-B565-D86EEA811241'" [primaryDefaultText]="'Password'" [secondaryDefaultText]="'Password'" /></span>
            <input type="password" formControlName="password" autocomplete="new-password" />
          </label>

          <label>
            <span><app-chill-i18n-label [labelGuid]="'14EB51FA-9D9B-427C-AFD6-CC54031B9B26'" [primaryDefaultText]="'Confirm password'" [secondaryDefaultText]="'Conferma password'" /></span>
            <input type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </label>

          <label class="checkbox full-width">
            <input type="checkbox" formControlName="createChillAuthUser" />
            <span><app-chill-i18n-label [labelGuid]="'E69C6D4F-07EC-42BA-B30D-AFA77B84E595'" [primaryDefaultText]="'Create linked Chill auth user'" [secondaryDefaultText]="'Crea utente auth Chill collegato'" /></span>
          </label>

          @if (form.hasError('passwordMismatch') && form.touched) {
            <div class="notice error full-width">{{ chill.T('12632967-9A9B-4A16-B7DF-D64B7BA7914A', 'Password confirmation does not match.', 'La conferma della password non corrisponde.') }}</div>
          }

          <button type="submit" class="full-width" [disabled]="isSubmitting() || form.invalid">
            @if (isSubmitting()) {
              <app-chill-i18n-button-label [labelGuid]="'A39321BE-5534-40B7-B1A7-F32BF872C997'" [primaryDefaultText]="'Creating account...'" [secondaryDefaultText]="'Creazione account in corso...'" />
            } @else {
              <app-chill-i18n-button-label [labelGuid]="'61E5DBBB-413A-449B-BE0E-B4A991FA1E39'" [primaryDefaultText]="'Create account'" [secondaryDefaultText]="'Crea account'" />
            }
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/login">{{ chill.T('1919121D-A2BC-403E-8FCA-E120630A1FAC', 'Back to login', 'Torna al login') }}</a>
          <a routerLink="/reset-password">{{ chill.T('1322FAE4-DBD5-4C8D-8988-FA6035551E02', 'Reset password', 'Reimposta password') }}</a>
        </nav>
      </div>
    </section>
  `
})
export class RegisterPageComponent {
  readonly chill = inject(ChillService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    userName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    displayName: [''],
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required, Validators.minLength(6)]],
    createChillAuthUser: [true]
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
    this.chill.register({
      UserName: value.userName,
      Email: value.email,
      Password: value.password,
      DisplayName: value.displayName,
      DisplayCultureName: this.readBrowserCultureName(),
      DisplayTimeZone: this.readBrowserTimeZone(),
      CreateChillAuthUser: value.createChillAuthUser
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.successMessage.set(this.chill.T('C91817F6-2CA4-461E-9D2B-EAD56F4B79BF', 'Account created and authenticated successfully.', 'Account creato e autenticato correttamente.'));
        setTimeout(() => {
          void this.router.navigate(['/workspace']);
        }, 700);
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private readBrowserCultureName(): string {
    const languages = globalThis.navigator?.languages;
    const browserCultureName = languages?.find((language) => typeof language === 'string' && language.trim())
      ?? globalThis.navigator?.language
      ?? '';
    return browserCultureName.trim() || CHILL_CULTURE;
  }

  private readBrowserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}
