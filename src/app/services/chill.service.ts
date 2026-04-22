import { Injectable, computed, inject, signal } from '@angular/core';
import { AsyncValidatorFn, FormControl, FormGroup } from '@angular/forms';
import {
  ChillSharpClientError,
  ChillSharpNgClient,
  type ChillAttachmentUploadFile,
  type ChillAttachmentUploadOptions,
  type AuthPermissionRuleItem as ChillSharpAuthPermissionRuleItem,
  type AuthRoleDetailsResponse,
  type ChillDtoMenuItem,
  type RegisterAuthIdentityRequest,
  type AuthUserDetailsResponse,
  type GetTextRequest,
  type JsonObject,
  type JsonValue,
  type ChillDtoEntityOptions,
  type SetAuthRoleRequest,
  type SetAuthUserRequest
} from 'chill-sharp-ng-client';
import type {
  ChillValidationError,
  LoginAuthIdentityRequest,
  RequestPasswordResetRequest as ChillSharpRequestPasswordResetRequest,
  ResetPasswordRequest as ChillSharpResetPasswordRequest
} from 'chill-sharp-ts-client';
import { Observable, catchError, firstValueFrom, from, map, switchMap, tap, throwError } from 'rxjs';
import type {
  AuthRoleAccessDetails,
  AuthUserAccessDetails,
  AuthPermissionRule,
  CreateAuthUserRequest,
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
  UpdateAuthUserRequest,
  UpdateUserProfileRequest
} from '../models/chill-auth.models';
import { PermissionAction, PermissionEffect, PermissionScope } from '../models/chill-auth.models';
import type {
  ChillEntityChangeNotification,
  ChillEntity,
  ChillEntityOptions,
  ChillMetadataRecord,
  ChillPropertySchema,
  ChillQuery,
  ChillSchema,
  ChillSchemaListItem
} from '../models/chill-schema.models';
import type { ChillMenuItem as AppChillMenuItem } from '../models/chill-menu.models';
import { CHILL_BASE_URL, CHILL_CULTURE, CHILL_PRIMARY_TEXT_CULTURE, CHILL_SECONDARY_TEXT_CULTURE } from '../chill.config';
import { WorkspaceDialogService } from './workspace-dialog.service';

const SESSION_STORAGE_KEY = 'chill-sharp-ng-ui.chill-auth-session';
const USER_PREFERENCES_STORAGE_KEY = 'chill-sharp-ng-ui.user-preferences';
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
  Select: 90,
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

interface StoredUserPreferences {
  displayCultureName: string;
  displayTimeZone: string;
  displayDateFormat: string;
  displayNumberFormat: string;
}

interface LoadCurrentUserPreferencesOptions {
  promptForTimeZoneMismatch: boolean;
  clearSessionOnNotFound: boolean;
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
  private readonly dialog = inject(WorkspaceDialogService);
  private readonly sessionState = signal<AuthSession | null>(this.readStoredSession());
  private readonly currentUserGuidState = signal('');
  private readonly userPreferencesState = signal<StoredUserPreferences>(this.readStoredUserPreferences());
  private readonly textVersion = signal(0);
  private readonly textCache = new Map<string, string>();
  private readonly pendingTextRequests = new Map<string, PendingTextRequest>();
  private readonly inFlightTextRequests = new Set<string>();
  private readonly pendingTextResolvers = new Map<string, Array<(value: string) => void>>();
  private readonly permissionRuleOwners = new Map<string, PermissionRuleOwner>();
  private isTimeZoneAlignmentPromptOpen = false;
  private textQueueHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  readonly session = this.sessionState.asReadonly();
  readonly isAuthenticated = computed(() => this.sessionState() !== null);
  readonly userName = computed(() => this.sessionState()?.userName ?? '');
  readonly displayCultureName = computed(() => this.userPreferencesState().displayCultureName);
  readonly displayTimeZone = computed(() => this.userPreferencesState().displayTimeZone);
  readonly displayDateFormat = computed(() => this.userPreferencesState().displayDateFormat);
  readonly displayNumberFormat = computed(() => this.userPreferencesState().displayNumberFormat);

  constructor() {
    this.syncClientSession(this.sessionState());
    this.logStartupDiagnostics();
  }

  async initialize(): Promise<void> {
    const userGuid = await this.resolveCurrentUserGuid();
    if (!userGuid) {
      return;
    }

    const user = await this.loadCurrentUserPreferences(userGuid, {
      promptForTimeZoneMismatch: false,
      clearSessionOnNotFound: true
    });
    if (!user) {
      return;
    }

    globalThis.setTimeout(() => {
      void this.promptForTimeZoneAlignment(userGuid, user);
    }, 0);
  }

  version(): string {
    const versionFn = (this.chill as unknown as { version?: () => string }).version;
    if (typeof versionFn !== 'function') {
      return this.T('1EB1A234-D374-48B1-9E14-C9A7BAE1C31D', 'Client version is unavailable on the current ChillSharp instance.', 'La versione del client non è disponibile nell\'istanza corrente di ChillSharp.');
    }

    return versionFn.call(this.chill);
  }

  currentCultureName(): string {
    return this.displayCultureName().trim() || CHILL_CULTURE;
  }

  currentTimeZone(): string {
    return this.displayTimeZone().trim() || this.readBrowserTimeZone();
  }

  currentDateFormat(): string {
    const configuredFormat = this.displayDateFormat().trim();
    return configuredFormat || this.defaultDateFormatForCulture(this.currentCultureName());
  }

  currentNumberFormat(): string {
    return this.displayNumberFormat().trim() || this.currentCultureName();
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
    const testUrl = this.buildApiUrl('test');

    return from(globalThis.fetch(testUrl)).pipe(
      switchMap((response) => {
        if (!response.ok) {
          return throwError(() => new Error(`Unexpected error executing GET ${testUrl}: ${response.status} ${response.statusText}`.trim()));
        }

        return from(response.text());
      }),
      map((response) => response.trim()),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getSchema(chillType: string, chillViewCode: string, cultureName?: string, update = false) {
    return this.chill.getSchema(chillType, chillViewCode, this.resolveCultureName(cultureName), update).pipe(
      map((response) => this.normalizeSchema(response as ChillSchema | null)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  setSchema(schema: ChillSchema) {
    const request = {
      ...schema,
      chillType: schema.chillType ?? '',
      chillViewCode: schema.chillViewCode ?? '',
      displayName: schema.displayName ?? '',
      handleAttachments: schema.handleAttachments === true,
      enableMCP: schema.enableMCP === true,
      mcpDescription: schema.mcpDescription?.trim() ?? '',
      queryRelatedChillType: schema.queryRelatedChillType ?? null,
      metadata: this.serializeMetadataRecord(schema.metadata),
      properties: (schema.properties ?? []).map((property) => ({
        ...property,
        name: property.name,
        displayName: property.displayName ?? property.name,
        propertyType: (property.propertyType ?? 0) as never,
        simplePropertyType: property.simplePropertyType ?? '',
        mcpDescription: property.mcpDescription ?? '',
        chillType: property.chillType ?? null,
        referenceChillType: property.referenceChillType ?? null,
        referenceChillTypeQuery: property.referenceChillTypeQuery ?? null,
        isReadOnly: property.isReadOnly ?? false,
        minLength: property.minLength ?? null,
        maxLength: property.maxLength ?? null,
        integerMinValue: property.integerMinValue ?? null,
        integerMaxValue: property.integerMaxValue ?? null,
        decimalMinValue: property.decimalMinValue ?? null,
        decimalMaxValue: property.decimalMaxValue ?? null,
        decimalPlaces: property.decimalPlaces ?? null,
        precision: property.precision ?? null,
        scale: property.scale ?? null,
        dateFormat: property.dateFormat ?? '',
        customFormat: property.customFormat ?? '',
        regexPattern: property.regexPattern ?? '',
        enumValues: property.enumValues ?? null,
        metadata: this.serializeMetadataRecord(property.metadata)
      }))
    };
    delete (request as unknown as Record<string, unknown>)['Metadata'];
    delete (request as unknown as Record<string, unknown>)['Properties'];

    return this.chill.setSchema(request).pipe(
      map((response) => this.normalizeSchema(response as ChillSchema | null)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getSchemaList(cultureName?: string) {
    const client = this.chill as unknown as ChillSharpNgClientSchemaListSupport;
    const resolvedCultureName = this.resolveCultureName(cultureName);

    if (typeof client.getSchemaList === 'function') {
      return this.chill.getSchemaList(resolvedCultureName).pipe(
        map((response) => (response ?? []) as ChillSchemaListItem[]),
        catchError((error) => this.rethrowFriendlyError(error))
      );
    }

    const rawClient = client.getRawClient?.();
    if (typeof rawClient?.getSchemaList === 'function') {
      return from(rawClient.getSchemaList(resolvedCultureName)).pipe(
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

  setText(labelGuid: string, value: string, cultureName?: string) {
    const normalizedLabelGuid = this.normalizeLabelGuid(labelGuid);
    const normalizedValue = value.trim();

    return this.chill.setText({
      labelGuid: normalizedLabelGuid,
      cultureName: this.resolveCultureName(cultureName),
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

  getAuthUserDetails(userGuid: string) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => response as AuthUserDetailsResponse),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  createAuthUser(request: CreateAuthUserRequest) {
    return this.chill.setAuthUser({
      guid: null,
      externalId: request.externalId,
      userName: request.userName,
      displayName: request.displayName,
      displayCultureName: request.displayCultureName,
      displayTimeZone: request.displayTimeZone,
      displayDateFormat: request.displayDateFormat,
      displayNumberFormat: request.displayNumberFormat,
      isActive: request.isActive,
      canManagePermissions: request.canManagePermissions,
      canManageSchema: request.canManageSchema,
      menuHierarchy: request.menuHierarchy,
      roleGuids: [],
      permissions: []
    }).pipe(
      map((response) => this.normalizeAuthUser(response)),
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

  updateUserProfile(userGuid: string, request: UpdateUserProfileRequest) {
    return this.chill.getAuthUser(userGuid).pipe(
      map((response) => this.buildSetAuthUserRequest(response, {
        externalId: response.externalId,
        userName: response.userName,
        displayName: request.displayName,
        displayCultureName: request.displayCultureName,
        displayTimeZone: request.displayTimeZone,
        displayDateFormat: request.displayDateFormat,
        displayNumberFormat: request.displayNumberFormat,
        isActive: response.isActive,
        canManagePermissions: response.canManagePermissions,
        canManageSchema: response.canManageSchema,
        menuHierarchy: response.menuHierarchy ?? ''
      })),
      switchMap((payload) => this.chill.setAuthUser(payload)),
      map((response) => response as AuthUserDetailsResponse),
      tap((response) => {
        if (this.isCurrentUser(userGuid)) {
          this.persistUserPreferences(this.toStoredUserPreferences(response));
        }
      }),
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

  uploadAttachment(targetEntity: JsonObject, file: ChillAttachmentUploadFile, options: ChillAttachmentUploadOptions = {}) {
    return this.chill.uploadAttachment(targetEntity, file, options).pipe(
      map((response) => response as JsonObject[]),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  downloadAttachment(attachmentOrGuid: JsonObject | string) {
    return this.chill.downloadAttachment(attachmentOrGuid).pipe(
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getMenu(parentGuid?: string | null) {
    return this.chill.getMenu(parentGuid).pipe(
      map((response) => (response ?? []).map((item) => this.normalizeMenuItem(item))),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  getEntityOptions(chillType: string) {
    return this.chill.getEntityOptions(chillType).pipe(
      map((response) => this.normalizeEntityOptions(response)),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  setEntityOptions(entityOptions: ChillEntityOptions) {
    return this.chill.setEntityOptions(this.toEntityOptionsDto(entityOptions)).pipe(
      map((response) => this.normalizeEntityOptions(response)),
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

  formatDisplayNumber(value: number): string {
    const numberFormat = this.readNumberFormatConfig();
    if (numberFormat.kind === 'locale') {
      return new Intl.NumberFormat(numberFormat.locale).format(value);
    }

    return this.formatNumberWithPattern(value, numberFormat);
  }

  parseDisplayInteger(value: string): number | null {
    const parsedValue = this.parseLocalizedNumber(value);
    return parsedValue !== null && Number.isInteger(parsedValue)
      ? parsedValue
      : null;
  }

  parseDisplayDecimal(value: string): number | null {
    return this.parseLocalizedNumber(value);
  }

  readDisplayNumber(value: JsonValue | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      return this.parseLocalizedNumber(value);
    }

    return null;
  }

  formatDisplayDate(value: string): string {
    const normalizedValue = value.trim();
    const match = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (!match) {
      return normalizedValue;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return this.isValidDateParts(year, month, day)
      ? this.formatDateParts(year, month, day)
      : normalizedValue;
  }

  parseDisplayDate(value: string): string | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }

    const leadingIsoDateMatch = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (leadingIsoDateMatch) {
      const year = Number(leadingIsoDateMatch[1]);
      const month = Number(leadingIsoDateMatch[2]);
      const day = Number(leadingIsoDateMatch[3]);
      return this.isValidDateParts(year, month, day)
        ? this.toIsoDate(year, month, day)
        : null;
    }

    const parts = this.parseDisplayDateParts(normalizedValue);
    if (parts) {
      return this.toIsoDate(parts.year, parts.month, parts.day);
    }

    const parsed = new Date(normalizedValue);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return this.toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }

  formatDisplayTime(value: string): string {
    const normalizedValue = this.parseDisplayTime(value);
    if (!normalizedValue) {
      return value.trim();
    }

    const match = normalizedValue.match(/^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?$/);
    if (!match) {
      return normalizedValue;
    }

    const seconds = match[3] && match[3] !== '00' ? `:${match[3]}` : '';
    const fraction = seconds ? (match[4] ?? '') : '';
    return `${match[1]}:${match[2]}${seconds}${fraction}`;
  }

  parseDisplayTime(value: string): string | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }

    const directMatch = normalizedValue.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?$/);
    if (directMatch) {
      return this.normalizeTimeParts(directMatch[1], directMatch[2], directMatch[3], directMatch[4]);
    }

    const isoMatch = normalizedValue.match(
      /^\d{4}-\d{2}-\d{2}[T\s](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?$/
    );
    if (isoMatch) {
      return this.normalizeTimeParts(isoMatch[1], isoMatch[2], isoMatch[3], isoMatch[4]);
    }

    return null;
  }

  formatDisplayDateTime(value: string): string {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return '';
    }

    const parsed = new Date(normalizedValue);
    if (Number.isNaN(parsed.getTime())) {
      return normalizedValue;
    }

    const parts = this.readZonedDateTimeParts(parsed, this.currentTimeZone());
    const formattedDate = this.formatDateParts(parts.year, parts.month, parts.day);
    const seconds = parts.second !== 0 ? `:${`${parts.second}`.padStart(2, '0')}` : '';
    return `${formattedDate} ${`${parts.hour}`.padStart(2, '0')}:${`${parts.minute}`.padStart(2, '0')}${seconds}`;
  }

  parseDisplayDateTime(value: string): string | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }

    const directMatch = normalizedValue.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?$/
    );
    if (directMatch) {
      const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetText] = directMatch;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const hour = Number(hourText);
      const minute = Number(minuteText);
      const second = secondText ? Number(secondText) : 0;
      if (!this.isValidDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) {
        return null;
      }

      if (offsetText) {
        return `${yearText}-${monthText}-${dayText}T${`${hour}`.padStart(2, '0')}:${minuteText}:${`${second}`.padStart(2, '0')}${fractionText ?? ''}${offsetText}`;
      }

      return this.toZonedIsoDateTime(year, month, day, hour, minute, second, fractionText ?? '');
    }

    const splitMatch = normalizedValue.match(/^(.*?)[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?$/);
    if (splitMatch) {
      const dateParts = this.parseDisplayDateParts(splitMatch[1]);
      if (!dateParts) {
        return null;
      }

      const hour = Number(splitMatch[2]);
      const minute = Number(splitMatch[3]);
      const second = splitMatch[4] ? Number(splitMatch[4]) : 0;
      if (hour > 23 || minute > 59 || second > 59) {
        return null;
      }

      return this.toZonedIsoDateTime(
        dateParts.year,
        dateParts.month,
        dateParts.day,
        hour,
        minute,
        second,
        splitMatch[5] ?? ''
      );
    }

    const parsed = new Date(normalizedValue);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    const parts = this.readZonedDateTimeParts(parsed, this.currentTimeZone());
    return this.toZonedIsoDateTime(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second, '');
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
      switchMap((response) => from(this.handleAuthenticatedResponse(response, false)).pipe(map(() => response))),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  login(request: LoginRequest) {
    return this.chill.loginAuthAccount(this.toLoginAuthIdentityRequest(request)).pipe(
      map((response) => this.toTokenResponse(response as JsonObject)),
      switchMap((response) => from(this.handleAuthenticatedResponse(response, true)).pipe(map(() => response))),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  refreshSession() {
    return this.chill.refreshAuthAccount().pipe(
      map((response) => this.toTokenResponse(response as JsonObject)),
      switchMap((response) => from(this.handleAuthenticatedResponse(response, false)).pipe(map(() => response))),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  requestPasswordReset(request: RequestPasswordResetRequest) {
    return this.chill.requestAuthPasswordReset(this.toRequestPasswordResetRequest(request)).pipe(
      map((response) => response as unknown as PasswordResetTokenResponse),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  confirmPasswordReset(request: ResetPasswordRequest) {
    return this.chill.resetAuthPassword(this.toResetPasswordRequest(request)).pipe(
      map((response) => response as unknown as ResetPasswordResponse),
      catchError((error) => this.rethrowFriendlyError(error))
    );
  }

  logout() {
    this.clearSession();
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

  private clearSession(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    this.sessionState.set(null);
    this.currentUserGuidState.set('');
    this.syncClientSession(null);
  }

  private async handleAuthenticatedResponse(
    response: AuthTokenResponse,
    promptForTimeZoneMismatch: boolean
  ): Promise<void> {
    this.persistSession(response);
    const userGuid = await this.resolveCurrentUserGuid();
    if (!userGuid) {
      return;
    }

    await this.loadCurrentUserPreferences(userGuid, {
      promptForTimeZoneMismatch,
      clearSessionOnNotFound: false
    });
  }

  private async loadCurrentUserPreferences(
    userGuid: string,
    options: LoadCurrentUserPreferencesOptions
  ): Promise<AuthUserDetailsResponse | null> {
    try {
      const user = await firstValueFrom(this.getAuthUserDetails(userGuid));
      this.currentUserGuidState.set(user.guid?.trim() ?? userGuid.trim());
      this.persistUserPreferences(this.toStoredUserPreferences(user));
      if (options.promptForTimeZoneMismatch) {
        await this.promptForTimeZoneAlignment(userGuid, user);
      }
      return user;
    } catch (error) {
      if (options.clearSessionOnNotFound && this.isNotFoundError(error)) {
        console.info('[ChillService] Current user was not found while loading preferences. Clearing stale session.', {
          userGuid
        });
        this.clearSession();
        return null;
      }

      console.warn('[ChillService] Unable to load current user preferences', error);
      return null;
    }
  }

  private async resolveCurrentUserGuid(): Promise<string> {
    const session = this.sessionState();
    const normalizedUserId = session?.userId?.trim() ?? '';
    const normalizedUserName = session?.userName?.trim().toLowerCase() ?? '';
    if (!normalizedUserId && !normalizedUserName) {
      return '';
    }

    try {
      const users = await firstValueFrom(this.getAuthUsers());
      const matchedUser = users.find((user) =>
        user.guid.trim() === normalizedUserId
        || user.userName.trim().toLowerCase() === normalizedUserName
      );
      if (matchedUser?.guid.trim()) {
        return matchedUser.guid.trim();
      }
    } catch (error) {
      console.warn('[ChillService] Unable to resolve current user guid from auth user list', error);
    }

    return normalizedUserId;
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
        return this.parseTimeValue(normalized);
      case CHILL_PROPERTY_TYPE.Duration:
        return normalized;
      case CHILL_PROPERTY_TYPE.DateTime:
        return this.parseDateTimeValue(normalized);
      case CHILL_PROPERTY_TYPE.Boolean:
        return this.parseBooleanValue(normalized);
      case CHILL_PROPERTY_TYPE.String:
      case CHILL_PROPERTY_TYPE.Text:
      case CHILL_PROPERTY_TYPE.Select:
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
      case CHILL_PROPERTY_TYPE.Select:
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
    return this.parseDisplayInteger(value);
  }

  private parseDecimalValue(value: string): JsonValue {
    return this.parseDisplayDecimal(value);
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
    return this.parseDisplayDate(value);
  }

  private parseTimeValue(value: string): JsonValue {
    return this.parseDisplayTime(value);
  }

  private parseDateTimeValue(value: string): JsonValue {
    return this.parseDisplayDateTime(value);
  }

  private resolveCultureName(cultureName?: string | null): string {
    const normalizedCultureName = cultureName?.trim();
    return normalizedCultureName || this.currentCultureName();
  }

  private defaultDateFormatForCulture(cultureName: string): string {
    return cultureName.trim().toLowerCase() === 'en-us'
      ? 'MM/dd/yyyy'
      : 'dd/MM/yyyy';
  }

  private formatDateParts(year: number, month: number, day: number): string {
    return this.currentDateFormat().replace(/yyyy|yy|YYYY|YY|dd|DD|MM/g, (token) => {
      switch (token) {
        case 'yyyy':
        case 'YYYY':
          return `${year}`.padStart(4, '0');
        case 'yy':
        case 'YY':
          return `${year % 100}`.padStart(2, '0');
        case 'dd':
        case 'DD':
          return `${day}`.padStart(2, '0');
        case 'MM':
          return `${month}`.padStart(2, '0');
        default:
          return token;
      }
    });
  }

  private parseDisplayDateParts(value: string): { year: number; month: number; day: number } | null {
    const normalizedValue = value.trim();
    const format = this.currentDateFormat();
    const tokenRegex = /(dd|MM|yyyy|yy|DD|YYYY|YY)/g;
    const tokens = format.match(tokenRegex) ?? [];
    if (tokens.length !== 3) {
      return null;
    }

    const separators = format.split(tokenRegex).filter((_, index) => index % 2 === 0);
    const escapedSeparators = separators.map((separator) => separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const capturePattern = tokens
      .map((token, index) => `${escapedSeparators[index] ?? ''}${this.normalizeDateFormatToken(token) === 'yyyy' ? '(\\d{4})' : this.normalizeDateFormatToken(token) === 'yy' ? '(\\d{2})' : '(\\d{1,2})'}`)
      .join('') + (escapedSeparators[separators.length - 1] ?? '');
    const match = normalizedValue.match(new RegExp(`^${capturePattern}$`));
    if (!match) {
      return null;
    }

    const values = match.slice(1);
    const parsedValues = Object.fromEntries(
      tokens.map((token, index) => [this.normalizeDateFormatToken(token), values[index]])
    ) as Record<string, string | undefined>;
    const yearToken = parsedValues['yyyy'] ?? parsedValues['yy'] ?? '';
    const year = (parsedValues['yyyy']
      ? Number(yearToken)
      : 2000 + Number(yearToken));
    const month = Number(parsedValues['MM'] ?? '');
    const day = Number(parsedValues['dd'] ?? '');
    return this.isValidDateParts(year, month, day)
      ? { year, month, day }
      : null;
  }

  private normalizeDateFormatToken(token: string): 'dd' | 'MM' | 'yyyy' | 'yy' {
    switch (token) {
      case 'DD':
        return 'dd';
      case 'YYYY':
        return 'yyyy';
      case 'YY':
        return 'yy';
      default:
        return token as 'dd' | 'MM' | 'yyyy' | 'yy';
    }
  }

  private toIsoDate(year: number, month: number, day: number): string {
    return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
  }

  private isValidDateParts(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }

    const candidate = new Date(year, month - 1, day);
    return candidate.getFullYear() === year
      && candidate.getMonth() === month - 1
      && candidate.getDate() === day;
  }

  private parseLocalizedNumber(value: string): number | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return null;
    }

    const numberFormat = this.readNumberFormatConfig();
    const formatter = numberFormat.kind === 'locale'
      ? new Intl.NumberFormat(numberFormat.locale)
      : null;
    const parts = formatter?.formatToParts(12345.6) ?? [];
    const groupSeparator = numberFormat.kind === 'pattern'
      ? numberFormat.groupSeparator
      : (parts.find((part) => part.type === 'group')?.value ?? ',');
    const decimalSeparator = numberFormat.kind === 'pattern'
      ? numberFormat.decimalSeparator
      : (parts.find((part) => part.type === 'decimal')?.value ?? '.');
    const signParts = formatter?.formatToParts(-1) ?? [];
    const minusSign = signParts.find((part) => part.type === 'minusSign')?.value ?? '-';

    let sanitizedValue = normalizedValue
      .replaceAll(String.fromCharCode(160), '')
      .replaceAll(' ', '');

    if (groupSeparator) {
      sanitizedValue = sanitizedValue.replaceAll(groupSeparator, '');
    }

    sanitizedValue = sanitizedValue
      .replaceAll(decimalSeparator, '.')
      .replaceAll(minusSign, '-');
    const parsedValue = Number(sanitizedValue);
    return Number.isFinite(parsedValue)
      ? parsedValue
      : null;
  }

  private readNumberFormatConfig():
    | { kind: 'locale'; locale: string }
    | { kind: 'pattern'; groupSeparator: string; decimalSeparator: string; fractionDigits: number } {
    const configuredFormat = this.currentNumberFormat().trim();
    if (this.isSupportedLocale(configuredFormat)) {
      return {
        kind: 'locale',
        locale: configuredFormat
      };
    }

    return this.parseNumberFormatPattern(configuredFormat);
  }

  private isSupportedLocale(value: string): boolean {
    if (!value) {
      return false;
    }

    try {
      return Intl.NumberFormat.supportedLocalesOf([value]).length > 0;
    } catch {
      return false;
    }
  }

  private parseNumberFormatPattern(value: string): {
    kind: 'pattern';
    groupSeparator: string;
    decimalSeparator: string;
    fractionDigits: number;
  } {
    const normalizedValue = value.trim();
    const lastDot = normalizedValue.lastIndexOf('.');
    const lastComma = normalizedValue.lastIndexOf(',');
    const decimalIndex = Math.max(lastDot, lastComma);
    const decimalSeparator = decimalIndex >= 0 ? normalizedValue[decimalIndex] : '.';
    const integerPart = decimalIndex >= 0 ? normalizedValue.slice(0, decimalIndex) : normalizedValue;
    const fractionPart = decimalIndex >= 0 ? normalizedValue.slice(decimalIndex + 1).replace(/[^\d]/g, '') : '';
    const groupSeparatorMatch = integerPart.match(/[^\d]/);

    return {
      kind: 'pattern',
      groupSeparator: groupSeparatorMatch?.[0] ?? '',
      decimalSeparator,
      fractionDigits: fractionPart.length
    };
  }

  private formatNumberWithPattern(
    value: number,
    pattern: { groupSeparator: string; decimalSeparator: string; fractionDigits: number }
  ): string {
    const sign = value < 0 ? '-' : '';
    const absoluteValue = Math.abs(value);
    const fixedValue = pattern.fractionDigits > 0
      ? absoluteValue.toFixed(pattern.fractionDigits)
      : Math.round(absoluteValue).toString();
    const [integerPart, fractionPart = ''] = fixedValue.split('.');
    const groupedInteger = pattern.groupSeparator
      ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, pattern.groupSeparator)
      : integerPart;
    const hasNonZeroFraction = fractionPart.replace(/0/g, '').length > 0;

    return pattern.fractionDigits > 0 && hasNonZeroFraction
      ? `${sign}${groupedInteger}${pattern.decimalSeparator}${fractionPart}`
      : `${sign}${groupedInteger}`;
  }

  private toZonedIsoDateTime(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    fraction: string
  ): string | null {
    const baseUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let candidate = new Date(baseUtc);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const offsetMinutes = this.readTimeZoneOffsetMinutes(candidate, this.currentTimeZone());
      const nextCandidate = new Date(baseUtc - offsetMinutes * 60_000);
      if (nextCandidate.getTime() === candidate.getTime()) {
        break;
      }

      candidate = nextCandidate;
    }

    if (Number.isNaN(candidate.getTime())) {
      return null;
    }

    const offsetMinutes = this.readTimeZoneOffsetMinutes(candidate, this.currentTimeZone());
    return `${this.toIsoDate(year, month, day)}T${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}:${`${second}`.padStart(2, '0')}${fraction || ''}${this.formatOffsetMinutes(offsetMinutes)}`;
  }

  private normalizeTimeParts(
    hourText: string,
    minuteText: string,
    secondText?: string,
    fractionText?: string
  ): string | null {
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = secondText ? Number(secondText) : null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || (second !== null && (second < 0 || second > 59))) {
      return null;
    }

    const normalizedHour = `${hour}`.padStart(2, '0');
    const normalizedMinute = `${minute}`.padStart(2, '0');
    if (second === null) {
      return `${normalizedHour}:${normalizedMinute}`;
    }

    return `${normalizedHour}:${normalizedMinute}:${`${second}`.padStart(2, '0')}${fractionText ?? ''}`;
  }

  private formatOffsetMinutes(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;
    return `${sign}${`${hours}`.padStart(2, '0')}:${`${minutes}`.padStart(2, '0')}`;
  }

  private readZonedDateTimeParts(date: Date, timeZone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    return {
      year: Number(parts.find((part) => part.type === 'year')?.value ?? '0'),
      month: Number(parts.find((part) => part.type === 'month')?.value ?? '0'),
      day: Number(parts.find((part) => part.type === 'day')?.value ?? '0'),
      hour: Number(parts.find((part) => part.type === 'hour')?.value ?? '0'),
      minute: Number(parts.find((part) => part.type === 'minute')?.value ?? '0'),
      second: Number(parts.find((part) => part.type === 'second')?.value ?? '0')
    };
  }

  private readTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      hour: '2-digit',
      minute: '2-digit'
    });
    const offsetText = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
    if (offsetText === 'GMT' || offsetText === 'UTC') {
      return 0;
    }

    const match = offsetText.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) {
      return 0;
    }

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? '0');
    return sign * (hours * 60 + minutes);
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
      .map((role: { guid?: string | null }) => role.guid?.trim() ?? '')
      .filter((guid: string) => guid.length > 0);
    const permissions = response.permissions.map((permission: ChillSharpAuthPermissionRuleItem) => this.toAuthPermissionRuleItem(permission));

    return {
      guid: response.guid,
      externalId: overrides?.externalId ?? response.externalId,
      userName: overrides?.userName ?? response.userName,
      displayName: overrides?.displayName ?? response.displayName,
      displayCultureName: overrides?.displayCultureName ?? response.displayCultureName,
      displayTimeZone: overrides?.displayTimeZone ?? response.displayTimeZone,
      displayDateFormat: overrides?.displayDateFormat ?? response.displayDateFormat,
      displayNumberFormat: overrides?.displayNumberFormat ?? response.displayNumberFormat,
      isActive: overrides?.isActive ?? response.isActive,
      canManagePermissions: overrides?.canManagePermissions ?? response.canManagePermissions,
      canManageSchema: overrides?.canManageSchema ?? response.canManageSchema,
      menuHierarchy: overrides?.menuHierarchy ?? response.menuHierarchy ?? '',
      roleGuids: mutateRoleGuids ? mutateRoleGuids(roleGuids) : roleGuids,
      permissions: mutatePermissions ? mutatePermissions(permissions) : permissions
    };
  }

  private readStoredUserPreferences(): StoredUserPreferences {
    const rawPreferences = globalThis.localStorage?.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!rawPreferences) {
      return this.createEmptyUserPreferences();
    }

    try {
      const parsed = JSON.parse(rawPreferences) as Partial<StoredUserPreferences>;
      return {
        displayCultureName: parsed.displayCultureName?.trim() ?? '',
        displayTimeZone: parsed.displayTimeZone?.trim() ?? '',
        displayDateFormat: parsed.displayDateFormat?.trim() ?? '',
        displayNumberFormat: parsed.displayNumberFormat?.trim() ?? ''
      };
    } catch {
      globalThis.localStorage?.removeItem(USER_PREFERENCES_STORAGE_KEY);
      return this.createEmptyUserPreferences();
    }
  }

  private createEmptyUserPreferences(): StoredUserPreferences {
    return {
      displayCultureName: '',
      displayTimeZone: '',
      displayDateFormat: '',
      displayNumberFormat: ''
    };
  }

  private persistUserPreferences(preferences: StoredUserPreferences): void {
    const previousPreferences = this.userPreferencesState();
    const previousCultureName = this.userPreferencesState().displayCultureName.trim().toLowerCase();
    const nextCultureName = preferences.displayCultureName.trim().toLowerCase();
    globalThis.localStorage?.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    this.userPreferencesState.set(preferences);
    this.logUserPreferencesUpdate(previousPreferences, preferences);
    if (previousCultureName !== nextCultureName) {
      this.textCache.clear();
      this.pendingTextRequests.clear();
      this.inFlightTextRequests.clear();
      this.pendingTextResolvers.clear();
      this.textVersion.update((current) => current + 1);
    }
  }

  private toStoredUserPreferences(user: AuthUserDetailsResponse): StoredUserPreferences {
    return {
      displayCultureName: this.readJsonString(user, 'DisplayCultureName') ?? user.displayCultureName ?? '',
      displayTimeZone: this.readJsonString(user, 'DisplayTimeZone') ?? user.displayTimeZone ?? '',
      displayDateFormat: this.readJsonString(user, 'DisplayDateFormat') ?? user.displayDateFormat ?? '',
      displayNumberFormat: this.readJsonString(user, 'DisplayNumberFormat') ?? user.displayNumberFormat ?? ''
    };
  }

  private async promptForTimeZoneAlignment(userGuid: string, user: AuthUserDetailsResponse): Promise<void> {
    const browserTimeZone = this.readBrowserTimeZone();
    const userTimeZone = (this.readJsonString(user, 'DisplayTimeZone') ?? user.displayTimeZone ?? '').trim();
    if (!browserTimeZone || !userTimeZone || browserTimeZone === userTimeZone || this.isTimeZoneAlignmentPromptOpen) {
      return;
    }

    this.isTimeZoneAlignmentPromptOpen = true;
    try {
      const shouldAlign = await this.dialog.confirmYesNo(
        this.T('3A9D83B1-B1D0-48A1-B917-340496692645', 'Align time zone', 'Allinea fuso orario'),
        this.T(
          'B8D2AC57-314D-4B0B-B6C6-ED4D6422163F',
          `Your browser uses ${browserTimeZone}, but your profile is set to ${userTimeZone}. Do you want to align your profile time zone?`,
          `Il browser usa ${browserTimeZone}, ma il profilo e impostato su ${userTimeZone}. Vuoi allineare il fuso orario del profilo?`
        )
      );
      if (!shouldAlign) {
        return;
      }

      const updatedUser = await firstValueFrom(this.updateUserProfile(userGuid, {
        displayName: user.displayName ?? '',
        displayCultureName: user.displayCultureName ?? '',
        displayTimeZone: browserTimeZone,
        displayDateFormat: user.displayDateFormat ?? '',
        displayNumberFormat: user.displayNumberFormat ?? ''
      }));
      this.persistUserPreferences(this.toStoredUserPreferences(updatedUser));
    } finally {
      this.isTimeZoneAlignmentPromptOpen = false;
    }
  }

  private readBrowserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  private isCurrentUser(userGuid: string): boolean {
    const normalizedUserGuid = userGuid.trim();
    if (!normalizedUserGuid) {
      return false;
    }

    const resolvedCurrentUserGuid = this.currentUserGuidState().trim();
    if (resolvedCurrentUserGuid) {
      return normalizedUserGuid === resolvedCurrentUserGuid;
    }

    return normalizedUserGuid === (this.sessionState()?.userId?.trim() ?? '');
  }

  private toRegisterAuthIdentityRequest(request: RegisterRequest): RegisterAuthIdentityRequest {
    return {
      userName: request.UserName,
      email: request.Email?.trim() || null,
      password: request.Password,
      displayName: request.DisplayName,
      displayCultureName: request.DisplayCultureName,
      displayTimeZone: request.DisplayTimeZone,
      createChillAuthUser: request.CreateChillAuthUser
    };
  }

  private toLoginAuthIdentityRequest(request: LoginRequest): LoginAuthIdentityRequest {
    return {
      userNameOrEmail: request.UserNameOrEmail,
      password: request.Password
    };
  }

  private toRequestPasswordResetRequest(request: RequestPasswordResetRequest): ChillSharpRequestPasswordResetRequest {
    return {
      userNameOrEmail: request.UserNameOrEmail
    };
  }

  private toResetPasswordRequest(request: ResetPasswordRequest): ChillSharpResetPasswordRequest {
    return {
      userId: request.UserId,
      resetToken: request.ResetToken,
      newPassword: request.NewPassword
    };
  }

  private buildSetAuthRoleRequest(
    response: AuthRoleDetailsResponse | null,
    overrides?: CreateAuthRoleRequest | UpdateAuthRoleRequest,
    mutateUserGuids?: (userGuids: string[]) => string[],
    mutatePermissions?: (permissions: ChillSharpAuthPermissionRuleItem[]) => ChillSharpAuthPermissionRuleItem[]
  ): SetAuthRoleRequest {
    const userGuids = response?.users
      .map((user: { guid?: string | null }) => user.guid?.trim() ?? '')
      .filter((guid: string) => guid.length > 0) ?? [];
    const permissions = response?.permissions.map((permission: ChillSharpAuthPermissionRuleItem) => this.toAuthPermissionRuleItem(permission)) ?? [];

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
      positionNo: Number.isFinite(response.positionNo) ? response.positionNo : 0,
      title: response.title?.trim() ?? '',
      description: response.description?.trim() || null,
      parent: response.parent ? {
        guid: response.parent.guid?.trim() ?? '',
        positionNo: Number.isFinite(response.parent.positionNo) ? response.parent.positionNo : 0,
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
      positionNo: Number.isFinite(menuItem.positionNo) ? menuItem.positionNo : 0,
      title: menuItem.title?.trim() ?? '',
      description: menuItem.description?.trim() || null,
      parent: menuItem.parent ? {
        guid: menuItem.parent.guid?.trim() ?? '',
        positionNo: Number.isFinite(menuItem.parent.positionNo) ? menuItem.parent.positionNo : 0,
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

  private normalizeEntityOptions(response: ChillDtoEntityOptions): ChillEntityOptions {
    const responseObject = this.isJsonObject(response) ? response : {};
    return {
      chillType: response.chillType?.trim() ?? '',
      checksumEnabled: !!response.checksumEnabled,
      handleAttachments: !!response.handleAttachments,
      labelFormatString: response.labelFormatString?.trim() || null,
      shortLabelFormatString: response.shortLabelFormatString?.trim() || null,
      fullTextContentFormatString: response.fullTextContentFormatString?.trim() || null,
      changeLogEnabled: !!response.changeLogEnabled,
      enableMCP: this.readJsonBoolean(responseObject, 'EnableMCP'),
      mcpDescription: this.readJsonString(responseObject, 'MCPDescription') ?? null
    };
  }

  private toEntityOptionsDto(entityOptions: ChillEntityOptions): ChillDtoEntityOptions & { enableMCP: boolean; mcpDescription: string | null } {
    return {
      chillType: entityOptions.chillType?.trim() ?? '',
      checksumEnabled: !!entityOptions.checksumEnabled,
      handleAttachments: !!entityOptions.handleAttachments,
      labelFormatString: entityOptions.labelFormatString?.trim() || null,
      shortLabelFormatString: entityOptions.shortLabelFormatString?.trim() || null,
      fullTextContentFormatString: entityOptions.fullTextContentFormatString?.trim() || null,
      changeLogEnabled: !!entityOptions.changeLogEnabled,
      enableMCP: !!entityOptions.enableMCP,
      mcpDescription: entityOptions.mcpDescription?.trim() || null
    };
  }

  private normalizeSchema(response: ChillSchema | null): ChillSchema | null {
    if (!response || !this.isJsonObject(response)) {
      return response;
    }

    return {
      ...response,
      chillType: this.readJsonString(response, 'ChillType') ?? '',
      chillViewCode: this.readJsonString(response, 'ChillViewCode') ?? '',
      displayName: this.readJsonString(response, 'DisplayName') ?? '',
      handleAttachments: this.readJsonBoolean(response, 'HandleAttachments'),
      enableMCP: this.readJsonBoolean(response, 'EnableMCP'),
      mcpDescription: this.readJsonString(response, 'MCPDescription') ?? null,
      queryRelatedChillType: this.readJsonString(response, 'QueryRelatedChillType') ?? undefined,
      metadata: this.normalizeMetadataRecord(response['metadata'] ?? response['Metadata']),
      properties: this.normalizeSchemaProperties(response['properties'] ?? response['Properties'])
    };
  }

  private normalizeSchemaProperties(value: unknown): ChillPropertySchema[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((property): property is ChillPropertySchema & JsonObject => this.isJsonObject(property))
      .map((property) => ({
        ...property,
        name: this.readJsonString(property, 'Name') ?? '',
        displayName: this.readJsonString(property, 'DisplayName') ?? property.name ?? '',
        simplePropertyType: this.readJsonString(property, 'SimplePropertyType') ?? property.simplePropertyType ?? '',
        mcpDescription: this.readJsonString(property, 'MCPDescription') ?? property.mcpDescription ?? '',
        metadata: this.normalizeMetadataRecord(property['metadata'] ?? property['Metadata'])
      }));
  }

  private normalizeMetadataRecord(value: unknown): ChillMetadataRecord {
    if (!this.isJsonObject(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (typeof entryValue === 'string') {
          return [key, entryValue];
        }

        if (typeof entryValue === 'number' || typeof entryValue === 'boolean') {
          return [key, String(entryValue)];
        }

        if (entryValue === null) {
          return [key, ''];
        }

        return [key, entryValue as JsonValue];
      })
    );
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
      displayCultureName: this.readJsonString(response, 'DisplayCultureName') ?? '',
      displayTimeZone: this.readJsonString(response, 'DisplayTimeZone') ?? '',
      displayDateFormat: this.readJsonString(response, 'DisplayDateFormat') ?? '',
      displayNumberFormat: this.readJsonString(response, 'DisplayNumberFormat') ?? '',
      isActive: this.readJsonBoolean(response, 'IsActive'),
      canManagePermissions: this.readJsonBoolean(response, 'CanManagePermissions'),
      canManageSchema: this.readJsonBoolean(response, 'CanManageSchema'),
      menuHierarchy: this.readJsonString(response, 'MenuHierarchy') ?? ''
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
        cultureName: this.currentCultureName(),
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

    const cultureName = this.currentCultureName();
    if (this.culturesMatch(cultureName, CHILL_SECONDARY_TEXT_CULTURE) && secondaryText) {
      return secondaryText;
    }

    if (this.culturesMatch(cultureName, CHILL_PRIMARY_TEXT_CULTURE) && primaryText) {
      return primaryText;
    }

    return primaryText || secondaryText;
  }

  private culturesMatch(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private logUserPreferencesUpdate(previous: StoredUserPreferences, next: StoredUserPreferences): void {
    console.log('[ChillService] User preferences updated', {
      previous,
      next,
      changed: {
        displayCultureName: previous.displayCultureName !== next.displayCultureName,
        displayTimeZone: previous.displayTimeZone !== next.displayTimeZone,
        displayDateFormat: previous.displayDateFormat !== next.displayDateFormat,
        displayNumberFormat: previous.displayNumberFormat !== next.displayNumberFormat
      }
    });
  }

  private logStartupDiagnostics(): void {
    console.log('[ChillService] Startup', {
      baseUrl: CHILL_BASE_URL,
      culture: this.currentCultureName(),
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

    this.test().subscribe({
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

  private buildApiUrl(relativeUrl: string): string {
    const normalizedBaseUrl = CHILL_BASE_URL.trim().replace(/\/+$/, '');
    const chillSuffix = '/chill';
    const apiBaseUrl = normalizedBaseUrl.toLowerCase().endsWith(chillSuffix)
      ? normalizedBaseUrl.slice(0, -chillSuffix.length)
      : normalizedBaseUrl;

    return `${apiBaseUrl}/${relativeUrl.replace(/^\/+/, '')}`;
  }

  private serializeMetadataRecord(metadata: ChillMetadataRecord | undefined): Record<string, string> {
    if (!metadata) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(metadata).flatMap(([key, value]) => {
        if (value === undefined) {
          return [];
        }

        if (typeof value === 'string') {
          return [[key, value]];
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
          return [[key, String(value)]];
        }

        if (value === null) {
          return [[key, '']];
        }

        try {
          return [[key, JSON.stringify(value)]];
        } catch {
          return [[key, '']];
        }
      })
    );
  }

  private rethrowFriendlyError(error: unknown) {
    if (error instanceof ChillSharpClientError) {
      const message = this.readChillErrorMessage(error);
      return throwError(() => new Error(message));
    }

    return throwError(() => error);
  }

  private isNotFoundError(error: unknown): boolean {
    if (error instanceof ChillSharpClientError) {
      return error.statusCode === 404;
    }

    if (error instanceof Error) {
      return error.message.trim().toLowerCase() === 'not found';
    }

    return false;
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
      const clientError = error as ChillSharpClientError & Error & { cause?: unknown };
      console.error(`[ChillService] ${context} failed`, {
        name: clientError.name,
        message: clientError.message,
        statusCode: clientError.statusCode,
        responseText: clientError.responseText,
        cause: clientError.cause,
        stack: clientError.stack
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
