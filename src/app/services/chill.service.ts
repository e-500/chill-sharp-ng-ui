import { Injectable, computed, inject, signal } from '@angular/core';
import { AsyncValidatorFn, FormControl, FormGroup } from '@angular/forms';
import {
  ChillSharpClientError,
  ChillSharpNgClient,
  type AuthPermissionRuleItem as ChillSharpAuthPermissionRuleItem,
  type AuthRoleDetailsResponse,
  type ChillDtoMenuItem,
  type RegisterAuthIdentityRequest,
  type AuthUserDetailsResponse,
  type GetTextRequest,
  type JsonObject,
  type JsonValue,
  type SetAuthRoleRequest,
  type SetAuthUserRequest
} from 'chill-sharp-ng-client';
import type { ChillValidationError } from 'chill-sharp-ts-client';
import { Observable, catchError, firstValueFrom, from, map, switchMap, tap, throwError } from 'rxjs';
import type {
  AuthRoleAccessDetails,
  AuthUserAccessDetails,
  AuthPermissionRule,
  AuthRole,
  AuthSession,
  AuthTokenResponse,
  AuthUser,
  EditableAuthPermissionRule,
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
import { PermissionAction, PermissionEffect, PermissionScope } from '../models/chill-auth.models';
import type {
  ChillEntityChangeNotification,
  ChillEntity,
  ChillPropertySchema,
  ChillQuery,
  ChillSchema,
  ChillSchemaListItem
} from '../models/chill-schema.models';
import type { ChillMenuItem as AppChillMenuItem } from '../models/chill-menu.models';
import { CHILL_BASE_URL, CHILL_CULTURE, CHILL_PRIMARY_TEXT_CULTURE, CHILL_SECONDARY_TEXT_CULTURE } from '../chill.config';

const SESSION_STORAGE_KEY = 'cini-home.chill-auth-session';
const TEXT_QUEUE_DELAY_MS = 50;
const CHILL_PROPERTY_TYPE = {
  Unknown: 0,
  Guid: 1,
  Integer: 10,
  Decimal: 20,
  Date: 30,
  Time: 40,
  DateTime: 50,
  Duration: 60,
  Boolean: 70,
  String: 80,
  Text: 81,
  Json: 99,
  ChillEntity: 1000,
  ChillEntityCollection: 1010,
  ChillQuery: 1100
} as const;

interface PendingTextRequest {
  request: GetTextRequest;
  fallbackText: string;
}

interface PermissionRuleOwner {
  kind: 'user' | 'role';
  guid: string;
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

interface ChillSharpNgClientPermissionLookupSupport {
  getModuleList?: () => Observable<unknown>;
  getQueryList?: (module?: string | null) => Observable<unknown>;
  getEntityList?: (module?: string | null) => Observable<unknown>;
  getPropertyList?: (chillType: string) => Observable<unknown>;
  getAuthModuleList?: () => Observable<unknown>;
  getAuthQueryList?: (module?: string | null) => Observable<unknown>;
  getAuthEntityList?: (module?: string | null) => Observable<unknown>;
  getAuthPropertyList?: (chillType: string) => Observable<unknown>;
}

interface ChillSharpNgClientValidationSupport {
  validate?: (dto: JsonObject) => Observable<unknown>;
  getRawClient?: () => {
    validate?: (dto: JsonObject) => Promise<unknown>;
  };
}

interface ChillSharpNgClientLookupSupport {
  lookup?: (dtoQuery: JsonObject) => Observable<unknown>;
  getRawClient?: () => {
    lookup?: (dtoQuery: JsonObject) => Promise<unknown>;
  };
}

export type ChillPreparedFormControls<TSchema extends ChillSchema> = Record<
  Extract<TSchema['properties'][number], { name: string }>['name'],
  FormControl<JsonValue>
>;

interface PrepareFormOptions<TSchema extends ChillSchema> {
  createControlAsyncValidators?: (context: {
    schema: TSchema;
    property: ChillPropertySchema;
    source?: ChillEntity | ChillQuery | null;
    getForm: () => FormGroup<ChillPreparedFormControls<TSchema>>;
  }) => AsyncValidatorFn | AsyncValidatorFn[] | null;
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
  private readonly permissionRuleOwners = new Map<string, PermissionRuleOwner>();
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

  setSchema(schema: ChillSchema) {
    return this.chill.setSchema({
      ...schema,
      chillType: schema.chillType ?? '',
      chillViewCode: schema.chillViewCode ?? '',
      displayName: schema.displayName ?? '',
      queryRelatedChillType: schema.queryRelatedChillType ?? null,
      metadata: schema.metadata ?? {},
      properties: (schema.properties ?? []).map((property) => ({
        ...property,
        name: property.name,
        displayName: property.displayName ?? property.name,
        propertyType: (property.propertyType ?? 0) as never,
        chillType: property.chillType ?? null,
        referenceChillType: property.referenceChillType ?? null,
        referenceChillTypeQuery: property.referenceChillTypeQuery ?? null,
        metadata: property.metadata ?? {}
      }))
    }).pipe(
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

  setText(labelGuid: string, value: string, cultureName = CHILL_CULTURE) {
    const normalizedLabelGuid = this.normalizeLabelGuid(labelGuid);
    const normalizedValue = value.trim();

    return this.chill.setText({
      labelGuid: normalizedLabelGuid,
      cultureName,
      value: normalizedValue
    }).pipe(
      map((response) => {
        const resolvedLabelGuid = this.readJsonString(response, 'LabelGuid') ?? normalizedLabelGuid;
        const resolvedValue = this.readJsonString(response, 'Value') ?? normalizedValue;
        this.textCache.set(this.normalizeLabelGuid(resolvedLabelGuid), resolvedValue);
        this.textVersion.update((current) => current + 1);
        return resolvedValue;
      }),
      catchError((error) => this.rethrowFriendlyError(error))
    );
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
    return this.chill.getAuthUserList().pipe(
      map((response) => this.normalizeAuthUsers(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  updateAuthUser(userGuid: string, request: UpdateAuthUserRequest) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.buildSetAuthUserRequest(response, request)),
      switchMap((payload) => this.chill.setAuthUser(payload)),
      map((response) => this.normalizeAuthUser(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthUserRoles(userGuid: string) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.normalizeAuthRoles(response.roles)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthUserAccess(userGuid: string) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response): AuthUserAccessDetails => ({
        user: this.normalizeAuthUser(response),
        roles: this.normalizeAuthRoles(response.roles),
        permissions: this.normalizeAuthPermissionRules(response.permissions, { kind: 'user', guid: userGuid })
      })),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  saveAuthUserAccess(userGuid: string, roleGuids: string[], permissions: EditableAuthPermissionRule[]) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.buildSetAuthUserRequest(
        response,
        undefined,
        () => this.normalizeGuidList(roleGuids),
        () => permissions.map((permission) => this.toAuthPermissionRuleItem(permission as unknown as JsonObject))
      )),
      switchMap((payload) => this.chill.setAuthUser(payload)),
      map((response): AuthUserAccessDetails => ({
        user: this.normalizeAuthUser(response),
        roles: this.normalizeAuthRoles(response.roles),
        permissions: this.normalizeAuthPermissionRules(response.permissions, { kind: 'user', guid: userGuid })
      })),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  assignAuthRole(userGuid: string, roleGuid: string) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.buildSetAuthUserRequest(response, undefined, (roleGuids) => [...new Set([...roleGuids, roleGuid])])),
      switchMap((payload) => this.chill.setAuthUser(payload)),
      map(() => void 0),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  removeAuthRole(userGuid: string, roleGuid: string) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.buildSetAuthUserRequest(response, undefined, (roleGuids) => roleGuids.filter((entry) => entry !== roleGuid))),
      switchMap((payload) => this.chill.setAuthUser(payload)),
      map(() => void 0),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthRoles() {
    return this.chill.getAuthRoleList().pipe(
      map((response) => this.normalizeAuthRoles(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getModuleList() {
    const client = this.chill as unknown as ChillSharpNgClientPermissionLookupSupport;
    const source = typeof client.getModuleList === 'function'
      ? client.getModuleList.bind(this.chill)
      : client.getAuthModuleList?.bind(this.chill);

    if (!source) {
      return throwError(() => new Error('The current ChillSharp client does not expose getModuleList().'));
    }

    return source().pipe(
      map((response) => this.normalizeStringList(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getEntityList(module?: string | null) {
    const client = this.chill as unknown as ChillSharpNgClientPermissionLookupSupport;
    const source = typeof client.getEntityList === 'function'
      ? client.getEntityList.bind(this.chill)
      : client.getAuthEntityList?.bind(this.chill);

    if (!source) {
      return throwError(() => new Error('The current ChillSharp client does not expose getEntityList().'));
    }

    return source(module).pipe(
      map((response) => this.normalizeStringList(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getQueryList(module?: string | null) {
    const client = this.chill as unknown as ChillSharpNgClientPermissionLookupSupport;
    const source = typeof client.getQueryList === 'function'
      ? client.getQueryList.bind(this.chill)
      : client.getAuthQueryList?.bind(this.chill);

    if (!source) {
      return throwError(() => new Error('The current ChillSharp client does not expose getQueryList().'));
    }

    return source(module).pipe(
      map((response) => this.normalizeStringList(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getPropertyList(chillType: string) {
    const client = this.chill as unknown as ChillSharpNgClientPermissionLookupSupport;
    const source = typeof client.getPropertyList === 'function'
      ? client.getPropertyList.bind(this.chill)
      : client.getAuthPropertyList?.bind(this.chill);

    if (!source) {
      return throwError(() => new Error('The current ChillSharp client does not expose getPropertyList().'));
    }

    return source(chillType).pipe(
      map((response) => this.normalizeStringList(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthRoleAccess(roleGuid: string) {
    return this.chill.getAuthRole(roleGuid).pipe(
      map((response): AuthRoleAccessDetails => ({
        role: this.normalizeAuthRole(response),
        users: this.normalizeAuthUsers(response.users),
        permissions: this.normalizeAuthPermissionRules(response.permissions, { kind: 'role', guid: roleGuid })
      })),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  saveAuthRoleAccess(roleGuid: string, userGuids: string[], permissions: EditableAuthPermissionRule[]) {
    return this.chill.getAuthRole(roleGuid).pipe(
      map((response) => this.buildSetAuthRoleRequest(
        response,
        undefined,
        () => this.normalizeGuidList(userGuids),
        () => permissions.map((permission) => this.toAuthPermissionRuleItem(permission as unknown as JsonObject))
      )),
      switchMap((payload) => this.chill.setAuthRole(payload)),
      map((response): AuthRoleAccessDetails => ({
        role: this.normalizeAuthRole(response),
        users: this.normalizeAuthUsers(response.users),
        permissions: this.normalizeAuthPermissionRules(response.permissions, { kind: 'role', guid: roleGuid })
      })),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  createAuthRole(request: CreateAuthRoleRequest) {
    return this.chill.setAuthRole(this.buildSetAuthRoleRequest(null, request)).pipe(
      map((response) => this.normalizeAuthRole(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  updateAuthRole(roleGuid: string, request: UpdateAuthRoleRequest) {
    return this.chill.getAuthRole(roleGuid).pipe(
      map((response) => this.buildSetAuthRoleRequest(response, request)),
      switchMap((payload) => this.chill.setAuthRole(payload)),
      map((response) => this.normalizeAuthRole(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getAuthPermissionRules(userGuid?: string, roleGuid?: string) {
    if (userGuid?.trim()) {
      return this.chill.getAuthUser(userGuid).pipe(
        map((response) => this.normalizeAuthPermissionRules(response.permissions, { kind: 'user', guid: userGuid })),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    if (roleGuid?.trim()) {
      return this.chill.getAuthRole(roleGuid).pipe(
        map((response) => this.normalizeAuthPermissionRules(response.permissions, { kind: 'role', guid: roleGuid })),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return this.chill.getAuthPermissions().pipe(
      map((response) => this.normalizeAuthPermissionRules(response.permissions)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  createAuthPermissionRule(request: CreateAuthPermissionRuleRequest) {
    const userGuid = request.userGuid?.trim();
    if (userGuid) {
      return this.chill.getAuthUser(userGuid).pipe(
        map((response) => this.buildSetAuthUserRequest(
          response,
          undefined,
          undefined,
          (permissions) => [...permissions, this.toAuthPermissionRuleItem(request)]
        )),
        switchMap((payload) => this.chill.setAuthUser(payload)),
        map((response) => this.getLatestAuthPermissionRule(response.permissions, { kind: 'user', guid: userGuid })),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const roleGuid = request.roleGuid?.trim();
    if (roleGuid) {
      return this.chill.getAuthRole(roleGuid).pipe(
        map((response) => this.buildSetAuthRoleRequest(
          response,
          undefined,
          undefined,
          (permissions) => [...permissions, this.toAuthPermissionRuleItem(request)]
        )),
        switchMap((payload) => this.chill.setAuthRole(payload)),
        map((response) => this.getLatestAuthPermissionRule(response.permissions, { kind: 'role', guid: roleGuid })),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return throwError(() => new Error('Auth permission management requires either userGuid or roleGuid.'));
  }

  deleteAuthPermissionRule(ruleGuid: string) {
    const owner = this.permissionRuleOwners.get(ruleGuid.trim());
    if (!owner) {
      return throwError(() => new Error('Auth permission rule owner is unknown. Reload permissions before deleting a rule.'));
    }

    if (owner.kind === 'user') {
      return this.chill.getAuthUser(owner.guid).pipe(
        map((response) => this.buildSetAuthUserRequest(
          response,
          undefined,
          undefined,
          (permissions) => permissions.filter((permission) => this.readJsonString(permission, 'Guid') !== ruleGuid.trim())
        )),
        switchMap((payload) => this.chill.setAuthUser(payload)),
        map(() => {
          this.permissionRuleOwners.delete(ruleGuid.trim());
          return void 0;
        }),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return this.chill.getAuthRole(owner.guid).pipe(
      map((response) => this.buildSetAuthRoleRequest(
        response,
        undefined,
        undefined,
        (permissions) => permissions.filter((permission) => this.readJsonString(permission, 'Guid') !== ruleGuid.trim())
      )),
      switchMap((payload) => this.chill.setAuthRole(payload)),
      map(() => {
        this.permissionRuleOwners.delete(ruleGuid.trim());
        return void 0;
      }),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  query(request: ChillQuery) {
    return this.chill.query(request as unknown as JsonObject).pipe(
      map((response) => response as JsonObject),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  lookup(request: JsonObject) {
    const client = this.chill as unknown as ChillSharpNgClientLookupSupport;

    if (typeof client.lookup === 'function') {
      return client.lookup(request).pipe(
        map((response) => response as JsonObject),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const rawClient = client.getRawClient?.();
    if (typeof rawClient?.lookup === 'function') {
      return from(rawClient.lookup(request)).pipe(
        map((response) => response as JsonObject),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    return throwError(() => new Error(
      this.T(
        '2D0D795E-ABEA-4507-AB12-F2BE1E2FA8E8',
        'The current ChillSharp client does not expose lookup().',
        'Il client ChillSharp corrente non espone lookup().'
      )
    ));
  }

  autocomplete(request: JsonObject) {
    return this.chill.autocomplete(request).pipe(
      map((response) => response as JsonObject),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  find(request: JsonObject) {
    return this.chill.find(request).pipe(
      map((response) => response as JsonObject | null),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  validate(request: JsonObject) {
    return this.chill.validate(request).pipe(
      map((response) => (response ?? []) as ChillValidationError[]),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  create(request: JsonObject) {
    return this.chill.create(request).pipe(
      map((response) => response as JsonObject),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  update(request: JsonObject) {
    return this.chill.update(request).pipe(
      map((response) => response as JsonObject),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  delete(request: JsonObject) {
    return this.chill.delete(request).pipe(
      map(() => void 0),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  chunk(operations: JsonObject[]) {
    return this.chill.chunk(operations).pipe(
      map((response) => response as JsonObject[]),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getMenu(parentGuid?: string | null) {
    return this.chill.getMenu(parentGuid).pipe(
      map((response) => (response ?? []).map((item) => this.normalizeMenuItem(item))),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  setMenu(menuItem: AppChillMenuItem) {
    return this.chill.setMenu(this.toMenuDto(menuItem)).pipe(
      map((response) => this.normalizeMenuItem(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  deleteMenu(menuItemGuid: string) {
    return this.chill.deleteMenu(menuItemGuid).pipe(
      map(() => void 0),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  toJsonValue(schema: ChillSchema | null, propertyName: string, value: JsonValue | undefined): JsonValue {
    const property = schema?.properties.find((candidate) => candidate.name === propertyName);
    return this.serializePropertyValue(property, value);
  }

  prepareForm<TSchema extends ChillSchema>(
    schema: TSchema,
    source?: ChillEntity | ChillQuery | null,
    options?: PrepareFormOptions<TSchema>
  ): FormGroup<ChillPreparedFormControls<TSchema>> {
    const controls = Object.fromEntries(
      (schema.properties ?? []).map((property) => [
        property.name,
        new FormControl<JsonValue>(this.readPreparedFormValue(source, property), { nonNullable: true })
      ])
    ) as ChillPreparedFormControls<TSchema>;
    const form = new FormGroup<ChillPreparedFormControls<TSchema>>(controls);

    for (const property of schema.properties ?? []) {
      const control = controls[property.name as keyof ChillPreparedFormControls<TSchema>];
      const asyncValidators = options?.createControlAsyncValidators?.({
        schema,
        property,
        source,
        getForm: () => form
      });
      if (!control || !asyncValidators) {
        continue;
      }

      control.setAsyncValidators(asyncValidators);
    }

    return form;
  }

  register(request: RegisterRequest) {
    return this.chill.registerAuthAccount(this.toRegisterAuthIdentityRequest(request)).pipe(
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

  private readPermissionEffect(payload: JsonObject): PermissionEffect {
    const value = this.readJsonNumber(payload, 'Effect');
    return value === PermissionEffect.Deny
      ? PermissionEffect.Deny
      : PermissionEffect.Allow;
  }

  private readPermissionAction(payload: JsonObject): PermissionAction {
    const value = this.readJsonNumber(payload, 'Action');
    switch (value) {
      case PermissionAction.FullControl:
      case PermissionAction.Query:
      case PermissionAction.Create:
      case PermissionAction.Update:
      case PermissionAction.Delete:
      case PermissionAction.See:
      case PermissionAction.Modify:
        return value;
      default:
        return PermissionAction.Query;
    }
  }

  private readPermissionScope(payload: JsonObject): PermissionScope {
    const value = this.readJsonNumber(payload, 'Scope');
    switch (value) {
      case PermissionScope.Module:
      case PermissionScope.Entity:
      case PermissionScope.Property:
        return value;
      default:
        return PermissionScope.Module;
    }
  }

  private isJsonObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private readPreparedFormValue(source: ChillEntity | ChillQuery | null | undefined, property: ChillPropertySchema): JsonValue {
    const propertyName = property.name.trim();
    if (!source || !propertyName) {
      return this.emptySerializedValue(property.propertyType ?? CHILL_PROPERTY_TYPE.Unknown);
    }

    const properties = source.properties;
    if (properties && propertyName in properties) {
      return this.serializePropertyValue(property, properties[propertyName]);
    }

    if (propertyName in source) {
      return this.serializePropertyValue(property, source[propertyName]);
    }

    const pascalCaseName = `${propertyName[0]?.toUpperCase() ?? ''}${propertyName.slice(1)}`;
    return this.serializePropertyValue(property, source[pascalCaseName]);
  }

  private serializePropertyValue(property: ChillPropertySchema | undefined, value: JsonValue | undefined): JsonValue {
    const propertyType = property?.propertyType ?? CHILL_PROPERTY_TYPE.Unknown;

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value;
    }

    if (this.isJsonObject(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      return value;
    }

    const normalized = typeof value === 'string'
      ? value.trim()
      : '';
    if (!normalized) {
      return this.emptySerializedValue(propertyType);
    }

    switch (propertyType) {
      case CHILL_PROPERTY_TYPE.Guid:
        return normalized;
      case CHILL_PROPERTY_TYPE.Integer:
        return this.parseIntegerValue(normalized);
      case CHILL_PROPERTY_TYPE.Decimal:
        return this.parseDecimalValue(normalized);
      case CHILL_PROPERTY_TYPE.Date:
        return this.parseDateValue(normalized);
      case CHILL_PROPERTY_TYPE.Time:
      case CHILL_PROPERTY_TYPE.Duration:
        return normalized;
      case CHILL_PROPERTY_TYPE.DateTime:
        return this.parseDateTimeValue(normalized);
      case CHILL_PROPERTY_TYPE.Boolean:
        return this.parseBooleanValue(normalized);
      case CHILL_PROPERTY_TYPE.String:
      case CHILL_PROPERTY_TYPE.Text:
      case CHILL_PROPERTY_TYPE.Json:
        return normalized;
      case CHILL_PROPERTY_TYPE.ChillEntity:
      case CHILL_PROPERTY_TYPE.ChillQuery:
        return normalized;
      case CHILL_PROPERTY_TYPE.ChillEntityCollection:
        return normalized;
      case CHILL_PROPERTY_TYPE.Unknown:
      default:
        return normalized;
    }
  }

  private emptySerializedValue(propertyType: number): JsonValue {
    switch (propertyType) {
      case CHILL_PROPERTY_TYPE.String:
      case CHILL_PROPERTY_TYPE.Text:
      case CHILL_PROPERTY_TYPE.Json:
      case CHILL_PROPERTY_TYPE.Time:
      case CHILL_PROPERTY_TYPE.Duration:
      case CHILL_PROPERTY_TYPE.Unknown:
        return '';
      default:
        return null;
    }
  }

  private parseIntegerValue(value: string): JsonValue {
    if (!/^-?\d+$/.test(value)) {
      return null;
    }

    return Number(value);
  }

  private parseDecimalValue(value: string): JsonValue {
    const normalized = Number(value);
    return Number.isFinite(normalized)
      ? normalized
      : null;
  }

  private parseBooleanValue(value: string): JsonValue {
    const normalized = value.toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    if (normalized === 'false' || normalized === '0') {
      return false;
    }

    return null;
  }

  private parseDateValue(value: string): JsonValue {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    const year = parsed.getUTCFullYear();
    const month = `${parsed.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${parsed.getUTCDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseDateTimeValue(value: string): JsonValue {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? null
      : parsed.toISOString();
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

  private buildSetAuthUserRequest(
    response: AuthUserDetailsResponse,
    overrides?: UpdateAuthUserRequest,
    mutateRoleGuids?: (roleGuids: string[]) => string[],
    mutatePermissions?: (permissions: ChillSharpAuthPermissionRuleItem[]) => ChillSharpAuthPermissionRuleItem[]
  ): SetAuthUserRequest {
    const roleGuids = response.roles
      .map((role) => role.guid?.trim() ?? '')
      .filter((guid) => guid.length > 0);
    const permissions = response.permissions.map((permission) => this.toAuthPermissionRuleItem(permission));

      return {
        guid: response.guid,
        externalId: overrides?.externalId ?? response.externalId,
        userName: overrides?.userName ?? response.userName,
        displayName: overrides?.displayName ?? response.displayName,
        displayCultureName: response.displayCultureName,
        displayTimeZone: response.displayTimeZone,
        displayDateFormat: response.displayDateFormat,
        displayNumberFormat: response.displayNumberFormat,
        isActive: overrides?.isActive ?? response.isActive,
        canManagePermissions: overrides?.canManagePermissions ?? response.canManagePermissions,
        canManageSchema: response.canManageSchema,
        menuHierarchy: response.menuHierarchy ?? '',
        roleGuids: mutateRoleGuids ? mutateRoleGuids(roleGuids) : roleGuids,
        permissions: mutatePermissions ? mutatePermissions(permissions) : permissions
      };
    }

    private toRegisterAuthIdentityRequest(request: RegisterRequest): RegisterAuthIdentityRequest {
      return {
        userName: request.UserName,
        email: request.Email?.trim() || null,
        password: request.Password,
        displayName: request.DisplayName,
        displayCultureName: request.DisplayCultureName,
        createChillAuthUser: request.CreateChillAuthUser
      };
    }

  private buildSetAuthRoleRequest(
    response: AuthRoleDetailsResponse | null,
    overrides?: CreateAuthRoleRequest | UpdateAuthRoleRequest,
    mutateUserGuids?: (userGuids: string[]) => string[],
    mutatePermissions?: (permissions: ChillSharpAuthPermissionRuleItem[]) => ChillSharpAuthPermissionRuleItem[]
  ): SetAuthRoleRequest {
    const userGuids = response?.users
      .map((user) => user.guid?.trim() ?? '')
      .filter((guid) => guid.length > 0) ?? [];
    const permissions = response?.permissions.map((permission) => this.toAuthPermissionRuleItem(permission)) ?? [];

    return {
      guid: response?.guid ?? null,
      name: overrides?.name ?? response?.name ?? '',
      description: overrides?.description ?? response?.description ?? '',
      isActive: overrides?.isActive ?? response?.isActive ?? true,
      menuHierarchy: response?.menuHierarchy ?? '',
      userGuids: mutateUserGuids ? mutateUserGuids(userGuids) : userGuids,
      permissions: mutatePermissions ? mutatePermissions(permissions) : permissions
    };
  }

  private normalizeMenuItem(response: ChillDtoMenuItem): AppChillMenuItem {
    return {
      guid: response.guid?.trim() ?? '',
      title: response.title?.trim() ?? '',
      description: response.description?.trim() || null,
      parent: response.parent ? {
        guid: response.parent.guid?.trim() ?? '',
        title: response.parent.title?.trim() ?? '',
        description: response.parent.description?.trim() || null,
        parent: null,
        componentName: response.parent.componentName?.trim() ?? '',
        componentConfigurationJson: response.parent.componentConfigurationJson?.trim() || null,
        menuHierarchy: response.parent.menuHierarchy?.trim() ?? ''
      } : null,
      componentName: response.componentName?.trim() ?? '',
      componentConfigurationJson: response.componentConfigurationJson?.trim() || null,
      menuHierarchy: response.menuHierarchy?.trim() ?? ''
    };
  }

  private toMenuDto(menuItem: AppChillMenuItem): ChillDtoMenuItem {
    return {
      guid: menuItem.guid?.trim() ?? '',
      title: menuItem.title?.trim() ?? '',
      description: menuItem.description?.trim() || null,
      parent: menuItem.parent ? {
        guid: menuItem.parent.guid?.trim() ?? '',
        title: menuItem.parent.title?.trim() ?? '',
        description: menuItem.parent.description?.trim() || null,
        parent: null,
        componentName: menuItem.parent.componentName?.trim() ?? '',
        componentConfigurationJson: menuItem.parent.componentConfigurationJson?.trim() || null,
        menuHierarchy: menuItem.parent.menuHierarchy?.trim() ?? ''
      } : null,
      componentName: menuItem.componentName?.trim() ?? '',
      componentConfigurationJson: menuItem.componentConfigurationJson?.trim() || null,
      menuHierarchy: menuItem.menuHierarchy?.trim() ?? ''
    };
  }

  private toAuthPermissionRuleItem(
    response: CreateAuthPermissionRuleRequest | JsonObject
  ): ChillSharpAuthPermissionRuleItem {
    const source = response as JsonObject;
    return {
      guid: this.readJsonString(source, 'Guid') ?? null,
      effect: this.readPermissionEffect(source),
      action: this.readPermissionAction(source),
      scope: this.readPermissionScope(source),
      module: this.readJsonString(source, 'Module') ?? '',
      entityName: this.readJsonString(source, 'EntityName') ?? null,
      propertyName: this.readJsonString(source, 'PropertyName') ?? null,
      appliesToAllProperties: this.readJsonBoolean(source, 'AppliesToAllProperties'),
      description: this.readJsonString(source, 'Description') ?? ''
    };
  }

  private getLatestAuthPermissionRule(response: unknown, owner?: PermissionRuleOwner): AuthPermissionRule {
    const rules = this.normalizeAuthPermissionRules(response, owner);
    if (rules.length === 0) {
      throw new Error('Auth permission rule was not returned by the server.');
    }

    return rules[rules.length - 1];
  }

  private normalizeGuidList(values: string[]): string[] {
    return [...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )];
  }

  private normalizeStringList(values: unknown): string[] {
    return Array.isArray(values)
      ? [...new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )]
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

  private normalizeAuthPermissionRules(response: unknown, owner?: PermissionRuleOwner): AuthPermissionRule[] {
    return Array.isArray(response)
      ? response
        .filter((item): item is JsonObject => this.isJsonObject(item))
        .map((item) => this.normalizeAuthPermissionRule(item, owner))
      : [];
  }

  private normalizeAuthPermissionRule(response: JsonObject, owner?: PermissionRuleOwner): AuthPermissionRule {
    const rule = {
      guid: this.readJsonString(response, 'Guid') ?? '',
      userGuid: this.readJsonString(response, 'UserGuid') ?? (owner?.kind === 'user' ? owner.guid : ''),
      roleGuid: this.readJsonString(response, 'RoleGuid') ?? (owner?.kind === 'role' ? owner.guid : ''),
      effect: this.readPermissionEffect(response),
      action: this.readPermissionAction(response),
      scope: this.readPermissionScope(response),
      module: this.readJsonString(response, 'Module') ?? '',
      entityName: this.readJsonString(response, 'EntityName') ?? '',
      propertyName: this.readJsonString(response, 'PropertyName') ?? '',
      appliesToAllProperties: this.readJsonBoolean(response, 'AppliesToAllProperties'),
      description: this.readJsonString(response, 'Description') ?? '',
      createdUtc: this.readJsonString(response, 'CreatedUtc') ?? ''
    };

    const ownerKind = owner?.kind ?? (rule.userGuid ? 'user' : (rule.roleGuid ? 'role' : null));
    const ownerGuid = owner?.guid ?? rule.userGuid ?? rule.roleGuid ?? '';
    if (rule.guid && ownerKind && ownerGuid) {
      this.permissionRuleOwners.set(rule.guid, {
        kind: ownerKind,
        guid: ownerGuid
      });
    }

    return rule;
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
      const responses = await firstValueFrom(this.chill.getTexts(entries.map(([, entry]) => entry.request)));
      entries.forEach(([key, entry], index) => {
        const translatedText = this.readTextResponseValue(responses[index], entry.fallbackText);
        this.textCache.set(key, translatedText);
        this.inFlightTextRequests.delete(key);
        this.resolvePendingTextRequest(key, translatedText);
      });
    } catch (error) {
      this.logDetailedError('getTexts()', error);
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
