import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ChillService } from '../services/chill.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <div class="auth-card">
        <p class="eyebrow">ChillSharp Auth</p>
        <h1>Login</h1>
        <p class="lede">Authenticate against the ChillSharp Identity endpoints through a single Angular service.</p>

        @if (chill.isAuthenticated()) {
          <div class="notice success">
            Active session for <strong>{{ chill.userName() || 'current user' }}</strong>.
          </div>
        }

        @if (errorMessage()) {
          <div class="notice error">{{ errorMessage() }}</div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
          <label>
            <span>Username or email</span>
            <input type="text" formControlName="userNameOrEmail" autocomplete="username" />
          </label>

          <label>
            <span>Password</span>
            <input type="password" formControlName="password" autocomplete="current-password" />
          </label>

          <button type="submit" [disabled]="isSubmitting() || form.invalid">
            {{ isSubmitting() ? 'Signing in...' : 'Sign in' }}
          </button>
        </form>

        <nav class="auth-links">
          <a routerLink="/register">Create account</a>
          <a routerLink="/reset-password">Forgot password</a>
        </nav>
      </div>
    </section>
  `
})
export class LoginPageComponent {
  readonly chill = inject(ChillService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal('');
  readonly form = this.formBuilder.nonNullable.group({
    userNameOrEmail: ['', Validators.required],
    password: ['', Validators.required]
  });

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
        void this.router.navigateByUrl('/register');
      },
      error: (error: unknown) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }
}
