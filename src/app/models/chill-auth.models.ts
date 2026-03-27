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

export interface AuthUser {
  guid: string;
  externalId: string;
  userName: string;
  displayName: string;
  isActive: boolean;
  canManagePermissions: boolean;
}

export interface UpdateAuthUserRequest {
  externalId: string;
  userName: string;
  displayName: string;
  isActive: boolean;
  canManagePermissions: boolean;
}

export interface AuthRole {
  guid: string;
  name: string;
  description: string;
  isActive: boolean;
}

export interface CreateAuthRoleRequest {
  name: string;
  description: string;
  isActive: boolean;
}

export interface UpdateAuthRoleRequest extends CreateAuthRoleRequest {}

export enum PermissionEffect {
  Allow = 1,
  Deny = 2
}

export enum PermissionAction {
  FullControl = 0,
  Query = 1,
  Create = 2,
  Update = 3,
  Delete = 4,
  See = 5,
  Modify = 6
}

export enum PermissionScope {
  Module = 1,
  Entity = 2,
  Property = 3
}

export interface AuthPermissionRule {
  guid: string;
  userGuid?: string;
  roleGuid?: string;
  effect: PermissionEffect;
  action: PermissionAction;
  scope: PermissionScope;
  module: string;
  entityName?: string;
  propertyName?: string;
  appliesToAllProperties: boolean;
  description: string;
  createdUtc?: string;
}

export interface EditableAuthPermissionRule {
  guid?: string;
  effect: PermissionEffect;
  action: PermissionAction;
  scope: PermissionScope;
  module: string;
  entityName?: string;
  propertyName?: string;
  appliesToAllProperties: boolean;
  description: string;
}

export interface CreateAuthPermissionRuleRequest {
  userGuid?: string;
  roleGuid?: string;
  effect: PermissionEffect;
  action: PermissionAction;
  scope: PermissionScope;
  module: string;
  entityName?: string;
  propertyName?: string;
  appliesToAllProperties: boolean;
  description: string;
}

export interface AuthUserAccessDetails {
  user: AuthUser;
  roles: AuthRole[];
  permissions: AuthPermissionRule[];
}

export interface AuthRoleAccessDetails {
  role: AuthRole;
  users: AuthUser[];
  permissions: AuthPermissionRule[];
}
