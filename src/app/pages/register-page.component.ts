import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ChillService } from '../services/chill.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <div class="auth-card wide">
        <p class="eyebrow">{{ chill.T('A651A560-1828-4D67-8D60-8B97011231D7', 'ChillSharp Auth', 'Autenticazione ChillSharp') }}</p>
        <h1>{{ chill.T('0A777B5C-F7D1-4084-B32F-D5162E100AF6', 'Register', 'Registrazione') }}</h1>
        <p class="lede">{{ chill.T('E4AB90A6-DB4D-4D34-BA80-8D07F6F5595D', 'Create an ASP.NET Core Identity account and optionally the linked ChillSharp auth user.', "Crea un account ASP.NET Core Identity e, facoltativamente, l'utente auth collegato di ChillSharp.") }}</p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form two-columns">
          <label>
            <span>{{ chill.T('2AF5EB08-932E-4D4D-9338-75E1808B5F16', 'Username', 'Nome utente') }}</span>
            <input type="text" formControlName="userName" autocomplete="username" />
          </label>

          <label>
            <span>{{ chill.T('311C8595-76C7-41DF-B4A0-0D0EF8E9A3D7', 'Email', 'Email') }}</span>
            <input type="email" formControlName="email" autocomplete="email" />
          </label>

          <label class="full-width">
            <span>{{ chill.T('C0D8A063-E084-460D-BF83-BCE32CB68588', 'Display name', 'Nome visualizzato') }}</span>
            <input type="text" formControlName="displayName" autocomplete="name" />
          </label>

          <label>
            <span>{{ chill.T('A76807CB-91F6-41A5-B565-D86EEA811241', 'Password', 'Password') }}</span>
            <input type="password" formControlName="password" autocomplete="new-password" />
          </label>

          <label>
            <span>{{ chill.T('14EB51FA-9D9B-427C-AFD6-CC54031B9B26', 'Confirm password', 'Conferma password') }}</span>
            <input type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </label>

          <label class="checkbox full-width">
            <input type="checkbox" formControlName="createChillAuthUser" />
            <span>{{ chill.T('E69C6D4F-07EC-42BA-B30D-AFA77B84E595', 'Create linked Chill auth user', 'Crea utente auth Chill collegato') }}</span>
          </label>

          @if (form.hasError('passwordMismatch') && form.touched) {
            <div class="notice error full-width">{{ chill.T('12632967-9A9B-4A16-B7DF-D64B7BA7914A', 'Password confirmation does not match.', 'La conferma della password non corrisponde.') }}</div>
          }

          <button type="submit" class="full-width" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting()
              ? chill.T('A39321BE-5534-40B7-B1A7-F32BF872C997', 'Creating account...', 'Creazione account in corso...')
              : chill.T('61E5DBBB-413A-449B-BE0E-B4A991FA1E39', 'Create account', 'Crea account') }}
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
      CreateChillAuthUser: value.createChillAuthUser
    }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.successMessage.set(this.chill.T('C91817F6-2CA4-461E-9D2B-EAD56F4B79BF', 'Account created and authenticated successfully.', 'Account creato e autenticato correttamente.'));
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
