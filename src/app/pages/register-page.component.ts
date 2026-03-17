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
        <p class="eyebrow">ChillSharp Auth</p>
        <h1>Register</h1>
        <p class="lede">Create an ASP.NET Core Identity account and optionally the linked ChillSharp auth user.</p>

        @if (successMessage()) {
          <div class="notice success">{{ successMessage() }}</div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form two-columns">
          <label>
            <span>Username</span>
            <input type="text" formControlName="userName" autocomplete="username" />
          </label>

          <label>
            <span>Email</span>
            <input type="email" formControlName="email" autocomplete="email" />
          </label>

          <label class="full-width">
            <span>Display name</span>
            <input type="text" formControlName="displayName" autocomplete="name" />
          </label>

          <label>
            <span>Password</span>
            <input type="password" formControlName="password" autocomplete="new-password" />
          </label>

          <label>
            <span>Confirm password</span>
            <input type="password" formControlName="confirmPassword" autocomplete="new-password" />
          </label>

          <label class="checkbox full-width">
            <input type="checkbox" formControlName="createChillAuthUser" />
            <span>Create linked Chill auth user</span>
          </label>

          @if (form.hasError('passwordMismatch') && form.touched) {
            <div class="notice error full-width">Password confirmation does not match.</div>
          }

          <button type="submit" class="full-width" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting() ? 'Creating account...' : 'Create account' }}
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/login">Back to login</a>
          <a routerLink="/reset-password">Reset password</a>
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
        this.successMessage.set('Account created and authenticated successfully.');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
