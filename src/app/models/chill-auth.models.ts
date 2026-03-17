export interface AuthTokenResponse {
  AccessToken?: string;
  AccessTokenIssuedUtc?: string;
  AccessTokenExpiresUtc?: string;
  RefreshToken?: string;
  RefreshTokenExpiresUtc?: string;
  UserId?: string;
  UserName?: string;
}

export interface RegisterRequest {
  UserName: string;
  Email?: string;
  Password: string;
  DisplayName: string;
  CreateChillAuthUser: boolean;
}

export interface LoginRequest {
  UserNameOrEmail: string;
  Password: string;
}

export interface RequestPasswordResetRequest {
  UserNameOrEmail: string;
}

export interface PasswordResetTokenResponse {
  IsAccepted?: boolean;
  UserId?: string;
  ResetToken?: string;
}

export interface ResetPasswordRequest {
  UserId: string;
  ResetToken: string;
  NewPassword: string;
}

export interface ResetPasswordResponse {
  Succeeded?: boolean;
}

export interface AuthSession {
  accessToken: string;
  accessTokenExpiresUtc: string;
  refreshToken: string;
  refreshTokenExpiresUtc: string;
  userId: string;
  userName: string;
}
