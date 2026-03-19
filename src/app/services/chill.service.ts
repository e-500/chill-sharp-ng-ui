import { Injectable, computed, inject, signal } from '@angular/core';
import { ChillSharpClientError, ChillSharpNgClient, type GetTextRequest, type JsonObject } from 'chill-sharp-ng-client';
import { Observable, catchError, firstValueFrom, from, map, tap, throwError } from 'rxjs';
import type {
  AuthPermissionRule,
  AuthRole,
  AuthSession,
  AuthTokenResponse,
  AuthUser,
  CreateAuthPermissionRuleRequest,
  CreateAuthRoleRequest,
  LoginRequest,
  PasswordResetTokenResponse,
  RegisterRequest,
  RequestPasswordResetRequest,
  ResetPasswordRequest,
  ResetPasswordResponse,
  UpdateAuthRoleRequest,
  UpdateAuthUserRequest
} from '../models/chill-auth.models';
import type {
  ChillEntityChangeNotification,
  ChillQuery,
  ChillSchema,
  ChillSchemaListItem
} from '../models/chill-schema.models';
import { CHILL_BASE_URL, CHILL_CULTURE, CHILL_PRIMARY_TEXT_CULTURE, CHILL_SECONDARY_TEXT_CULTURE } from '../chill.config';

const SESSION_STORAGE_KEY = 'cini-home.chill-auth-session';
const TEXT_QUEUE_DELAY_MS = 50;

interface PendingTextRequest {
  request: GetTextRequest;
  fallbackText: string;
}

interface ChillSharpClientSessionSync {
  applyAuthToken?: (payload: JsonObject, forgetPassword: boolean) => void;
}

interface ChillSharpNgClientSchemaListSupport {
  getSchemaList?: (cultureName?: string) => { pipe: (...args: unknown[]) => unknown };
  getRawClient?: () => {
    getSchemaList?: (cultureName?: string) => Promise<unknown>;
  };
}

interface ChillSharpNgClientEntityChangeSupport {
  watchEntityChanges?: (chillType: string, guid?: string | null) => Observable<ChillEntityChangeNotification[]>;
  disconnectEntityChanges?: () => Observable<void>;
  getRawClient?: () => {
    subscribeToEntityChanges?: (
      chillType: string,
      callback: (changes: ChillEntityChangeNotification[]) => void | Promise<void>,
      guid?: string | null
    ) => Promise<{ unsubscribe: () => Promise<void> }>;
    disconnectEntityChanges?: () => Promise<void>;
  };
}

interface ChillAuthManagementSupport {
  getRawClient?: () => {
    getAuthUsers?: () => Promise<unknown>;
    updateAuthUser?: (userGuid: string, request: JsonObject) => Promise<unknown>;
    getAuthUserRoles?: (userGuid: string) => Promise<unknown>;
    assignAuthRole?: (userGuid: string, roleGuid: string) => Promise<void>;
    removeAuthRole?: (userGuid: string, roleGuid: string) => Promise<void>;
    getAuthRoles?: () => Promise<unknown>;
    createAuthRole?: (request: JsonObject) => Promise<unknown>;
    updateAuthRole?: (roleGuid: string, request: JsonObject) => Promise<unknown>;
    getAuthPermissionRules?: (userGuid?: string, roleGuid?: string) => Promise<unknown>;
    createAuthPermissionRule?: (request: JsonObject) => Promise<unknown>;
    deleteAuthPermissionRule?: (ruleGuid: string) => Promise<void>;
  };
}

@Injectable({
  providedIn: 'root'
})
export class ChillService {
  private readonly chill = inject(ChillSharpNgClient);
  private readonly sessionState = signal<AuthSession | null>(this.readStoredSession());
  private readonly textVersion = signal(0);
  private readonly textCache = new Map<string, string>();
  private readonly pendingTextRequests = new Map<string, PendingTextRequest>();
  private readonly inFlightTextRequests = new Set<string>();
  private readonly pendingTextResolvers = new Map<string, Array<(value: string) => void>>();
  private textQueueHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  readonly session = this.sessionState.asReadonly();
  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  readonly userName = computed(() => this.sessionState()?.userName ?? '');

  constructor() {
    this.syncClientSession(this.sessionState());
    this.logStartupDiagnostics();
  }

  version(): string {
    const versionFn = (this.chill as unknown as { version?: () => string }).version;
    if (typeof versionFn !== 'function') {
      return this.T('1EB1A234-D374-48B1-9E14-C9A7BAE1C31D', 'Client version is unavailable on the current ChillSharp instance.', 'La versione del client non è disponibile nell\'istanza corrente di ChillSharp.');
    }

    return versionFn.call(this.chill);
  }

  T(labelGuid: string, primaryDefaultText: string, secondaryDefaultText: string): string {
    this.textVersion();

    const key = this.normalizeLabelGuid(labelGuid);
    const fallbackText = this.selectDefaultText(primaryDefaultText, secondaryDefaultText);
    if (!key) {
      return fallbackText;
    }

    const cachedText = this.textCache.get(key);
    if (cachedText !== undefined) {
      return cachedText;
    }

    this.enqueueTextRequest(key, primaryDefaultText, secondaryDefaultText, fallbackText);
    return fallbackText;
  }

  async TAsync(labelGuid: string, primaryDefaultText: string, secondaryDefaultText: string): Promise<string> {
    const key = this.normalizeLabelGuid(labelGuid);
    const fallbackText = this.selectDefaultText(primaryDefaultText, secondaryDefaultText);
    if (!key) {
      return fallbackText;
    }

    const cachedText = this.textCache.get(key);
    if (cachedText !== undefined) {
      return cachedText;
    }

    return new Promise<string>((resolve) => {
      const pendingResolvers = this.pendingTextResolvers.get(key) ?? [];
      pendingResolvers.push(resolve);
      this.pendingTextResolvers.set(key, pendingResolvers);
      this.enqueueTextRequest(key, primaryDefaultText, secondaryDefaultText, fallbackText);
    });
  }

  test() {
    return this.chill.test().pipe(
      map((response) => response.trim()),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getSchema(chillType: string, chillViewCode: string, cultureName?: string) {
    return this.chill.getSchema(chillType, chillViewCode, cultureName).pipe(
      map((response) => response as ChillSchema | null),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getSchemaList(cultureName?: string) {
    const client = this.chill as unknown as ChillSharpNgClientSchemaListSupport;

    if (typeof client.getSchemaList === 'function') {
      return this.chill.getSchemaList(cultureName).pipe(
        map((response) => (response ?? []) as ChillSchemaListItem[]),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const rawClient = client.getRawClient?.();
    if (typeof rawClient?.getSchemaList === 'function') {
      return from(rawClient.getSchemaList(cultureName)).pipe(
        map((response) => (response ?? []) as ChillSchemaListItem[]),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return throwError(() => new Error(
      this.T(
        '25A8B513-F55B-428D-B85F-49A6D39F165A',
        'The current ChillSharp client does not expose getSchemaList().',
        'Il client ChillSharp corrente non espone getSchemaList().'
      )
    ));
  }

  watchEntityChanges(chillType: string, guid?: string | null) {
    const client = this.chill as unknown as ChillSharpNgClientEntityChangeSupport;

    if (typeof client.watchEntityChanges === 'function') {
      return client.watchEntityChanges(chillType, guid).pipe(
        map((changes) => changes.map((change) => this.normalizeEntityChangeNotification(change))),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const rawClient = client.getRawClient?.();
    if (typeof rawClient?.subscribeToEntityChanges === 'function') {
      const subscribeToEntityChanges = rawClient.subscribeToEntityChanges.bind(rawClient);
      return new Observable<ChillEntityChangeNotification[]>((subscriber) => {
        let remoteSubscription: { unsubscribe: () => Promise<void> } | null = null;
        let isClosed = false;

        void subscribeToEntityChanges(
            chillType,
            async (changes) => {
              subscriber.next(changes.map((change) => this.normalizeEntityChangeNotification(change)));
            },
            guid
          )
          .then(async (subscription) => {
            remoteSubscription = subscription;
            if (isClosed) {
              await subscription.unsubscribe();
            }
          })
          .catch((error) => {
            subscriber.error(error);
          });

        return () => {
          isClosed = true;
          if (remoteSubscription) {
            void remoteSubscription.unsubscribe();
          }
        };
      }).pipe(
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return throwError(() => new Error(
      this.T(
        '19AEF9E0-85E9-40DF-A786-22A61C52A9A3',
        'The current ChillSharp client does not expose entity-change notifications.',
        'Il client ChillSharp corrente non espone le notifiche di modifica entità.'
      )
    ));
  }

  watchEntity(chillType: string, guid: string) {
    return this.watchEntityChanges(chillType, guid);
  }

  watchChillType(chillType: string) {
    return this.watchEntityChanges(chillType, null);
  }

  disconnectEntityChanges() {
    const client = this.chill as unknown as ChillSharpNgClientEntityChangeSupport;

    if (typeof client.disconnectEntityChanges === 'function') {
      return client.disconnectEntityChanges().pipe(
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const rawClient = client.getRawClient?.();
    if (typeof rawClient?.disconnectEntityChanges === 'function') {
      return from(rawClient.disconnectEntityChanges()).pipe(
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return throwError(() => new Error(
      this.T(
        'BB7AA5AE-3615-47CE-B026-D7D17989D18D',
        'The current ChillSharp client does not expose notification disconnection.',
        'Il client ChillSharp corrente non espone la disconnessione delle notifiche.'
      )
    ));
  }

  getAuthUsers() {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.getAuthUsers !== 'function') {
      return throwError(() => new Error('Auth user management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.getAuthUsers()).pipe(
      map((response) => this.normalizeAuthUsers(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  updateAuthUser(userGuid: string, request: UpdateAuthUserRequest) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.updateAuthUser !== 'function') {
      return throwError(() => new Error('Auth user management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.updateAuthUser(userGuid, request as unknown as JsonObject)).pipe(
      map((response) => this.normalizeAuthUser(response as JsonObject)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthUserRoles(userGuid: string) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.getAuthUserRoles !== 'function') {
      return throwError(() => new Error('Auth role management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.getAuthUserRoles(userGuid)).pipe(
      map((response) => this.normalizeAuthRoles(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  assignAuthRole(userGuid: string, roleGuid: string) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.assignAuthRole !== 'function') {
      return throwError(() => new Error('Auth role assignment is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.assignAuthRole(userGuid, roleGuid)).pipe(
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  removeAuthRole(userGuid: string, roleGuid: string) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.removeAuthRole !== 'function') {
      return throwError(() => new Error('Auth role assignment is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.removeAuthRole(userGuid, roleGuid)).pipe(
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthRoles() {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.getAuthRoles !== 'function') {
      return throwError(() => new Error('Auth role management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.getAuthRoles()).pipe(
      map((response) => this.normalizeAuthRoles(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  createAuthRole(request: CreateAuthRoleRequest) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.createAuthRole !== 'function') {
      return throwError(() => new Error('Auth role management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.createAuthRole(request as unknown as JsonObject)).pipe(
      map((response) => this.normalizeAuthRole(response as JsonObject)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  updateAuthRole(roleGuid: string, request: UpdateAuthRoleRequest) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.updateAuthRole !== 'function') {
      return throwError(() => new Error('Auth role management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.updateAuthRole(roleGuid, request as unknown as JsonObject)).pipe(
      map((response) => this.normalizeAuthRole(response as JsonObject)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthPermissionRules(userGuid?: string, roleGuid?: string) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.getAuthPermissionRules !== 'function') {
      return throwError(() => new Error('Auth permission management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.getAuthPermissionRules(userGuid, roleGuid)).pipe(
      map((response) => this.normalizeAuthPermissionRules(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  createAuthPermissionRule(request: CreateAuthPermissionRuleRequest) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.createAuthPermissionRule !== 'function') {
      return throwError(() => new Error('Auth permission management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.createAuthPermissionRule(request as unknown as JsonObject)).pipe(
      map((response) => this.normalizeAuthPermissionRule(response as JsonObject)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  deleteAuthPermissionRule(ruleGuid: string) {
    const rawClient = (this.chill as unknown as ChillAuthManagementSupport).getRawClient?.();
    if (typeof rawClient?.deleteAuthPermissionRule !== 'function') {
      return throwError(() => new Error('Auth permission management is unavailable on the current ChillSharp client.'));
    }

    return from(rawClient.deleteAuthPermissionRule(ruleGuid)).pipe(
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  query(request: ChillQuery) {
    return this.chill.query(request as unknown as JsonObject).pipe(
      map((response) => response as JsonObject),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

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
    this.syncClientSession(null);
  }

  formatError(error: unknown): string {
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return this.T('48D1CE91-0230-4D35-90D0-A776D804B0A8', 'Unexpected error while calling ChillSharp.', 'Errore imprevisto durante la chiamata a ChillSharp.');
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
    this.syncClientSession(session);
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
    return {
      AccessToken: this.readJsonString(response, 'AccessToken'),
      AccessTokenIssuedUtc: this.readJsonString(response, 'AccessTokenIssuedUtc'),
      AccessTokenExpiresUtc: this.readJsonString(response, 'AccessTokenExpiresUtc'),
      RefreshToken: this.readJsonString(response, 'RefreshToken'),
      RefreshTokenExpiresUtc: this.readJsonString(response, 'RefreshTokenExpiresUtc'),
      UserId: this.readJsonString(response, 'UserId'),
      UserName: this.readJsonString(response, 'UserName')
    };
  }

  private syncClientSession(session: AuthSession | null): void {
    const client = this.chill.getRawClient() as unknown as ChillSharpClientSessionSync;
    if (typeof client.applyAuthToken !== 'function') {
      return;
    }

    client.applyAuthToken(
      {
        AccessToken: session?.accessToken ?? '',
        AccessTokenExpiresUtc: session?.accessTokenExpiresUtc ?? '',
        RefreshToken: session?.refreshToken ?? '',
        RefreshTokenExpiresUtc: session?.refreshTokenExpiresUtc ?? '',
        UserName: session?.userName ?? ''
      },
      true
    );
  }

  private readJsonString(payload: JsonObject, key: string): string | undefined {
    const directValue = payload[key];
    if (typeof directValue === 'string' && directValue.trim()) {
      return directValue.trim();
    }

    const camelKey = key.length > 1
      ? `${key[0].toLowerCase()}${key.slice(1)}`
      : key.toLowerCase();
    const camelValue = payload[camelKey];
    if (typeof camelValue === 'string' && camelValue.trim()) {
      return camelValue.trim();
    }

    const matchedKey = Object.keys(payload).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const matchedValue = matchedKey ? payload[matchedKey] : undefined;
    return typeof matchedValue === 'string' && matchedValue.trim()
      ? matchedValue.trim()
      : undefined;
  }

  private readJsonBoolean(payload: JsonObject, key: string): boolean {
    const directValue = payload[key];
    if (typeof directValue === 'boolean') {
      return directValue;
    }

    const matchedKey = Object.keys(payload).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const matchedValue = matchedKey ? payload[matchedKey] : undefined;
    return matchedValue === true;
  }

  private readJsonNumber(payload: JsonObject, key: string): number {
    const directValue = payload[key];
    if (typeof directValue === 'number') {
      return directValue;
    }

    const matchedKey = Object.keys(payload).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const matchedValue = matchedKey ? payload[matchedKey] : undefined;
    return typeof matchedValue === 'number' ? matchedValue : 0;
  }

  private isJsonObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private normalizeEntityChangeNotification(change: ChillEntityChangeNotification): ChillEntityChangeNotification {
    return {
      chillType: change.chillType?.trim() ?? '',
      guid: change.guid?.trim() ?? '',
      action: change.action
    };
  }

  private normalizeAuthUsers(response: unknown): AuthUser[] {
    return Array.isArray(response)
      ? response.filter((item): item is JsonObject => this.isJsonObject(item)).map((item) => this.normalizeAuthUser(item))
      : [];
  }

  private normalizeAuthUser(response: JsonObject): AuthUser {
    return {
      guid: this.readJsonString(response, 'Guid') ?? '',
      externalId: this.readJsonString(response, 'ExternalId') ?? '',
      userName: this.readJsonString(response, 'UserName') ?? '',
      displayName: this.readJsonString(response, 'DisplayName') ?? '',
      isActive: this.readJsonBoolean(response, 'IsActive'),
      canManagePermissions: this.readJsonBoolean(response, 'CanManagePermissions')
    };
  }

  private normalizeAuthRoles(response: unknown): AuthRole[] {
    return Array.isArray(response)
      ? response.filter((item): item is JsonObject => this.isJsonObject(item)).map((item) => this.normalizeAuthRole(item))
      : [];
  }

  private normalizeAuthRole(response: JsonObject): AuthRole {
    return {
      guid: this.readJsonString(response, 'Guid') ?? '',
      name: this.readJsonString(response, 'Name') ?? '',
      description: this.readJsonString(response, 'Description') ?? '',
      isActive: this.readJsonBoolean(response, 'IsActive')
    };
  }

  private normalizeAuthPermissionRules(response: unknown): AuthPermissionRule[] {
    return Array.isArray(response)
      ? response.filter((item): item is JsonObject => this.isJsonObject(item)).map((item) => this.normalizeAuthPermissionRule(item))
      : [];
  }

  private normalizeAuthPermissionRule(response: JsonObject): AuthPermissionRule {
    return {
      guid: this.readJsonString(response, 'Guid') ?? '',
      userGuid: this.readJsonString(response, 'UserGuid') ?? '',
      roleGuid: this.readJsonString(response, 'RoleGuid') ?? '',
      effect: this.readJsonNumber(response, 'Effect') as AuthPermissionRule['effect'],
      action: this.readJsonNumber(response, 'Action') as AuthPermissionRule['action'],
      scope: this.readJsonNumber(response, 'Scope') as AuthPermissionRule['scope'],
      module: this.readJsonString(response, 'Module') ?? '',
      entityName: this.readJsonString(response, 'EntityName') ?? '',
      propertyName: this.readJsonString(response, 'PropertyName') ?? '',
      appliesToAllProperties: this.readJsonBoolean(response, 'AppliesToAllProperties'),
      description: this.readJsonString(response, 'Description') ?? '',
      createdUtc: this.readJsonString(response, 'CreatedUtc') ?? ''
    };
  }

  private enqueueTextRequest(
    key: string,
    primaryDefaultText: string,
    secondaryDefaultText: string,
    fallbackText: string
  ): void {
    if (this.textCache.has(key) || this.pendingTextRequests.has(key) || this.inFlightTextRequests.has(key)) {
      return;
    }

    this.pendingTextRequests.set(key, {
      request: {
        labelGuid: key,
        cultureName: CHILL_CULTURE,
        primaryCultureName: CHILL_PRIMARY_TEXT_CULTURE,
        primaryDefaultText: primaryDefaultText ?? '',
        secondaryCultureName: CHILL_SECONDARY_TEXT_CULTURE,
        secondaryDefaultText: secondaryDefaultText ?? ''
      },
      fallbackText
    });

    this.scheduleTextQueueFlush();
  }

  private scheduleTextQueueFlush(): void {
    if (this.textQueueHandle !== null) {
      return;
    }

    this.textQueueHandle = globalThis.setTimeout(() => {
      this.textQueueHandle = null;
      void this.flushTextQueue();
    }, TEXT_QUEUE_DELAY_MS);
  }

  private async flushTextQueue(): Promise<void> {
    const entries = Array.from(this.pendingTextRequests.entries());
    if (entries.length === 0) {
      return;
    }

    this.pendingTextRequests.clear();
    entries.forEach(([key]) => this.inFlightTextRequests.add(key));

    try {
      const responses = entries.length === 1
        ? [await firstValueFrom(this.chill.getText(entries[0][1].request))]
        : await firstValueFrom(this.chill.getTexts(entries.map(([, entry]) => entry.request)));
      entries.forEach(([key, entry], index) => {
        const translatedText = this.readTextResponseValue(responses[index], entry.fallbackText);
        this.textCache.set(key, translatedText);
        this.inFlightTextRequests.delete(key);
        this.resolvePendingTextRequest(key, translatedText);
      });
    } catch (error) {
      this.logDetailedError(entries.length === 1 ? 'getText()' : 'getTexts()', error);
      entries.forEach(([key, entry]) => {
        this.textCache.set(key, entry.fallbackText);
        this.inFlightTextRequests.delete(key);
        this.resolvePendingTextRequest(key, entry.fallbackText);
      });
    }

    this.textVersion.update((value) => value + 1);
  }

  private resolvePendingTextRequest(key: string, value: string): void {
    const resolvers = this.pendingTextResolvers.get(key);
    if (!resolvers) {
      return;
    }

    this.pendingTextResolvers.delete(key);
    resolvers.forEach((resolve) => resolve(value));
  }

  private readTextResponseValue(response: JsonObject | null | undefined, fallbackText: string): string {
    const value = response?.['Value'];
    return typeof value === 'string' && value.trim() ? value.trim() : fallbackText;
  }

  private normalizeLabelGuid(labelGuid: string): string {
    return labelGuid.trim().toUpperCase();
  }

  private selectDefaultText(primaryDefaultText: string, secondaryDefaultText: string): string {
    const primaryText = primaryDefaultText.trim();
    const secondaryText = secondaryDefaultText.trim();

    if (this.culturesMatch(CHILL_CULTURE, CHILL_SECONDARY_TEXT_CULTURE) && secondaryText) {
      return secondaryText;
    }

    if (this.culturesMatch(CHILL_CULTURE, CHILL_PRIMARY_TEXT_CULTURE) && primaryText) {
      return primaryText;
    }

    return primaryText || secondaryText;
  }

  private culturesMatch(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private logStartupDiagnostics(): void {
    console.log('[ChillService] Startup', {
      baseUrl: CHILL_BASE_URL,
      culture: CHILL_CULTURE,
      hasStoredSession: this.sessionState() !== null
    });

    try {
      const version = this.version();
      if (version === this.T('1EB1A234-D374-48B1-9E14-C9A7BAE1C31D', 'Client version is unavailable on the current ChillSharp instance.', 'La versione del client non è disponibile nell\'istanza corrente di ChillSharp.')) {
        console.warn('[ChillService] Client version unavailable', {
          reason: version
        });
      } else {
        console.log('[ChillService] Client version', version);
      }
    } catch (error) {
      this.logDetailedError('version()', error);
    }

    this.chill.test().subscribe({
      next: (response: string) => {
        console.log('[ChillService] test() success', {
          response: response.trim()
        });
      },
      error: (error: unknown) => {
        this.logDetailedError('test()', error);
      }
    });
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

  private logDetailedError(context: string, error: unknown): void {
    if (error instanceof ChillSharpClientError) {
      console.error(`[ChillService] ${context} failed`, {
        name: error.name,
        message: error.message,
        statusCode: error.statusCode,
        responseText: error.responseText,
        cause: (error as Error & { cause?: unknown }).cause,
        stack: error.stack
      });
      return;
    }

    if (error instanceof Error) {
      console.error(`[ChillService] ${context} failed`, {
        name: error.name,
        message: error.message,
        cause: (error as Error & { cause?: unknown }).cause,
        stack: error.stack
      });
      return;
    }

    console.error(`[ChillService] ${context} failed`, error);
  }
}
