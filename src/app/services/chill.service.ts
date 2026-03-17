import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ChillSharpClientError, ChillSharpNgClient, type JsonObject } from 'chill-sharp-ng-client';
import { catchError, map, tap, throwError } from 'rxjs';
import type {
  AuthSession,
  AuthTokenResponse,
  LoginRequest,
  PasswordResetTokenResponse,
  RegisterRequest,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
  ResetPasswordResponse
} from '../models/chill-auth.models';

const SESSION_STORAGE_KEY = 'cini-home.chill-auth-session';

@Injectable({
  providedIn: 'root'
})
export class ChillService {
  private readonly chill = inject(ChillSharpNgClient);
  private readonly router = inject(Router);
  private readonly sessionState = signal<AuthSession | null>(this.readStoredSession());

  readonly session = this.sessionState.asReadonly();
  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  readonly userName = computed(() => this.sessionState()?.userName ?? '');

  register(request: RegisterRequest) {
    return this.chill.registerAuthAccount(request as unknown as JsonObject).pipe(
      map((response) => this.toTokenResponse(response as JsonObject)),
      tap((response) => this.persistSession(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  login(request: LoginRequest) {
    return this.chill.loginAuthAccount(request as unknown as JsonObject).pipe(
      map((response) => this.toTokenResponse(response as JsonObject)),
      tap((response) => this.persistSession(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  refreshSession() {
    return this.chill.refreshAuthAccount().pipe(
      map((response) => this.toTokenResponse(response as JsonObject)),
      tap((response) => this.persistSession(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  requestPasswordReset(request: RequestPasswordResetRequest) {
    return this.chill.requestAuthPasswordReset(request as unknown as JsonObject).pipe(
      map((response) => response as unknown as PasswordResetTokenResponse),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  confirmPasswordReset(request: ResetPasswordRequest) {
    return this.chill.resetAuthPassword(request as unknown as JsonObject).pipe(
      map((response) => response as unknown as ResetPasswordResponse),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  logout() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.sessionState.set(null);
    void this.router.navigateByUrl('/login');
  }

  formatError(error: unknown): string {
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Unexpected error while calling ChillSharp.';
  }

  private persistSession(response: AuthTokenResponse): void {
    const accessToken = response.AccessToken?.trim() ?? '';
    if (!accessToken) {
      return;
    }

    const session: AuthSession = {
      accessToken,
      accessTokenExpiresUtc: response.AccessTokenExpiresUtc ?? '',
      refreshToken: response.RefreshToken ?? '',
      refreshTokenExpiresUtc: response.RefreshTokenExpiresUtc ?? '',
      userId: response.UserId ?? '',
      userName: response.UserName ?? ''
    };

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    this.sessionState.set(session);
  }

  private readStoredSession(): AuthSession | null {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const session = JSON.parse(raw) as Partial<AuthSession>;
      if (!session.accessToken) {
        return null;
      }

      return {
        accessToken: session.accessToken,
        accessTokenExpiresUtc: session.accessTokenExpiresUtc ?? '',
        refreshToken: session.refreshToken ?? '',
        refreshTokenExpiresUtc: session.refreshTokenExpiresUtc ?? '',
        userId: session.userId ?? '',
        userName: session.userName ?? ''
      };
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  private toTokenResponse(response: JsonObject): AuthTokenResponse {
    return response as unknown as AuthTokenResponse;
  }

  private rethrowFriendlyError(error: unknown) {
    if (error instanceof ChillSharpClientError) {
      const message = this.readChillErrorMessage(error);
      return throwError(() => new Error(message));
    }

    return throwError(() => error);
  }

  private readChillErrorMessage(error: ChillSharpClientError): string {
    const responseText = error.responseText?.trim();
    if (!responseText) {
      return error.message;
    }

    try {
      const parsed = JSON.parse(responseText) as { title?: string; detail?: string; errors?: Record<string, string[]> };
      if (parsed.detail?.trim()) {
        return parsed.detail.trim();
      }

      const validationErrors = Object.values(parsed.errors ?? {})
        .flat()
        .filter((message) => message.trim().length > 0);

      if (validationErrors.length > 0) {
        return validationErrors.join(' ');
      }

      if (parsed.title?.trim()) {
        return parsed.title.trim();
      }
    } catch {
      return responseText;
    }

    return responseText;
  }
}
