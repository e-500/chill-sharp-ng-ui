import { ChillSharpClientError } from './errors';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface ChillSharpClientOptions {
  accessToken?: string;
  username?: string;
  password?: string;
  cultureName?: string;
  fetchImpl?: typeof fetch;
}

interface TokenState {
  accessToken: string | null;
  accessTokenIssuedUtc: Date | null;
  accessTokenExpiresUtc: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresUtc: Date | null;
}

export class ChillSharpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cultureName: string | null;
  private username: string | null;
  private password: string | null;
  private refreshPromise: Promise<JsonObject> | null = null;
  private tokenState: TokenState;

  constructor(baseUrl: string, options: ChillSharpClientOptions = {}) {
    this.baseUrl = this.normalizeRequiredValue(baseUrl, 'baseUrl').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.username = this.normalizeOptionalValue(options.username);
    this.password = this.normalizeOptionalValue(options.password);
    this.cultureName = this.normalizeOptionalValue(options.cultureName);
    this.tokenState = {
      accessToken: this.normalizeOptionalValue(options.accessToken),
      accessTokenIssuedUtc: null,
      accessTokenExpiresUtc: null,
      refreshToken: null,
      refreshTokenExpiresUtc: null
    };
  }

  query(dtoQuery: JsonObject): Promise<JsonObject> {
    return this.sendJson<JsonObject>('POST', this.buildChillUrl('query'), dtoQuery);
  }

  find(dtoEntity: JsonObject): Promise<JsonObject | null> {
    return this.sendJson<JsonObject | null>('POST', this.buildChillUrl('find'), dtoEntity);
  }

  create(dtoEntity: JsonObject): Promise<JsonObject> {
    return this.sendJson<JsonObject>('POST', this.buildChillUrl('create'), dtoEntity);
  }

  update(dtoEntity: JsonObject): Promise<JsonObject> {
    return this.sendJson<JsonObject>('POST', this.buildChillUrl('update'), dtoEntity);
  }

  async delete(dtoEntity: JsonObject): Promise<void> {
    await this.sendJson('POST', this.buildChillUrl('delete'), dtoEntity, false);
  }

  chunk(operations: JsonObject[]): Promise<JsonObject[]> {
    return this.sendJson<JsonObject[]>('POST', this.buildChillUrl('chunk'), operations);
  }

  getSchema(chillType: string, chillViewCode: string, cultureName?: string): Promise<JsonObject | null> {
    const encodedType = encodeURIComponent(this.normalizeRequiredValue(chillType, 'chillType'));
    const encodedView = encodeURIComponent(this.normalizeRequiredValue(chillViewCode, 'chillViewCode'));
    const effectiveCultureName = this.normalizeOptionalValue(cultureName) ?? this.cultureName;
    let relativeUrl = `get-schema?chillType=${encodedType}&chillViewCode=${encodedView}`;

    if (effectiveCultureName) {
      relativeUrl += `&cultureName=${encodeURIComponent(effectiveCultureName)}`;
    }

    return this.sendJson<JsonObject | null>('GET', this.buildChillUrl(relativeUrl));
  }

  setSchema(schema: JsonObject): Promise<JsonObject | null> {
    return this.sendJson<JsonObject | null>('POST', this.buildChillUrl('set-schema'), schema);
  }

  getText(labelGuid: string, cultureName: string): Promise<JsonObject | null> {
    const encodedGuid = encodeURIComponent(this.normalizeRequiredValue(labelGuid, 'labelGuid'));
    const encodedCulture = encodeURIComponent(this.normalizeRequiredValue(cultureName, 'cultureName'));
    return this.sendJson<JsonObject | null>('GET', this.buildI18nUrl(`text/${encodedGuid}/${encodedCulture}`));
  }

  setText(payload: JsonObject): Promise<JsonObject> {
    return this.sendJson<JsonObject>('PUT', this.buildI18nUrl('text'), payload);
  }

  async registerAuthAccount(payload: JsonObject): Promise<JsonObject> {
    const response = await this.sendAuthJson<JsonObject>('POST', 'account/register', payload, true, true);
    this.applyAuthToken(response, true);
    return response;
  }

  async loginAuthAccount(payload: JsonObject): Promise<JsonObject> {
    const response = await this.sendAuthJson<JsonObject>('POST', 'account/login', payload, true, true);
    this.applyAuthToken(response, true);
    return response;
  }

  refreshAuthAccount(): Promise<JsonObject> {
    return this.getAuthTokenIfNecessary(true);
  }

  changeAuthPassword(payload: JsonObject): Promise<JsonObject> {
    return this.sendAuthJson<JsonObject>('POST', 'account/change-password', payload);
  }

  requestAuthPasswordReset(payload: JsonObject): Promise<JsonObject> {
    return this.sendAuthJson<JsonObject>('POST', 'account/request-password-reset', payload, true, true);
  }

  resetAuthPassword(payload: JsonObject): Promise<JsonObject> {
    return this.sendAuthJson<JsonObject>('POST', 'account/reset-password', payload, true, true);
  }

  private sendAuthJson<T extends JsonValue | null>(
    method: string,
    relativeUrl: string,
    payload?: JsonValue,
    expectResponseBody = true,
    allowAnonymous = false
  ): Promise<T> {
    return this.sendJson<T>(method, this.buildAuthUrl(relativeUrl), payload, expectResponseBody, allowAnonymous);
  }

  private async sendJson<T extends JsonValue | null>(
    method: string,
    url: string,
    payload?: JsonValue,
    expectResponseBody = true,
    allowAnonymous = false,
    allowRetry = true
  ): Promise<T> {
    try {
      if (!allowAnonymous && this.canUseAuthentication()) {
        await this.getAuthTokenIfNecessary();
      }

      const headers = new Headers();
      if (!allowAnonymous && this.tokenState.accessToken) {
        headers.set('Authorization', `Bearer ${this.tokenState.accessToken}`);
      }

      if (payload !== undefined) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });

      if ((response.status === 401 || response.status === 403) && !allowAnonymous && allowRetry && await this.tryRefreshAuthentication()) {
        return this.sendJson<T>(method, url, payload, expectResponseBody, allowAnonymous, false);
      }

      if (!response.ok) {
        throw new ChillSharpClientError(
          `HTTP ${response.status} calling ${method} ${url}`,
          response.status,
          await response.text()
        );
      }

      if (!expectResponseBody) {
        return null as T;
      }

      const text = await response.text();
      if (!text.trim()) {
        return null as T;
      }

      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof ChillSharpClientError) {
        throw error;
      }

      throw new ChillSharpClientError(`Unexpected error executing ${method} ${url}`, undefined, undefined, error);
    }
  }

  private async getAuthTokenIfNecessary(forceRefresh = false): Promise<JsonObject> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.getAuthTokenIfNecessaryCore(forceRefresh);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async getAuthTokenIfNecessaryCore(forceRefresh: boolean): Promise<JsonObject> {
    if (!forceRefresh && this.hasUsableAccessToken() && !this.shouldRefreshAccessToken()) {
      return this.createCurrentTokenResponse();
    }

    if (this.tokenState.refreshToken && (!forceRefresh || !this.password)) {
      try {
        const refreshed = await this.sendAuthJson<JsonObject>(
          'POST',
          'account/refresh',
          { RefreshToken: this.tokenState.refreshToken },
          true,
          true
        );

        this.applyAuthToken(refreshed, true);
        return refreshed;
      } catch (error) {
        if (!(error instanceof ChillSharpClientError)) {
          throw error;
        }

        this.tokenState.refreshToken = null;
        this.tokenState.refreshTokenExpiresUtc = null;
      }
    }

    if (this.username && this.password) {
      const token = await this.sendAuthJson<JsonObject>(
        'POST',
        'account/login',
        {
          UserNameOrEmail: this.username,
          Password: this.password
        },
        true,
        true
      );

      this.applyAuthToken(token, true);
      return token;
    }

    if (this.hasUsableAccessToken()) {
      return this.createCurrentTokenResponse();
    }

    throw new ChillSharpClientError('No auth token is available and the client cannot obtain a new one.');
  }

  private applyAuthToken(payload: JsonObject, forgetPassword: boolean): void {
    this.tokenState.accessToken = this.readString(payload, 'AccessToken');
    this.tokenState.accessTokenIssuedUtc = this.parseDate(payload['AccessTokenIssuedUtc']);
    this.tokenState.accessTokenExpiresUtc = this.parseDate(payload['AccessTokenExpiresUtc']);
    this.tokenState.refreshToken = this.readString(payload, 'RefreshToken');
    this.tokenState.refreshTokenExpiresUtc = this.parseDate(payload['RefreshTokenExpiresUtc']);

    const userName = this.readString(payload, 'UserName');
    if (userName) {
      this.username = userName;
    }

    if (forgetPassword) {
      this.password = null;
    }
  }

  private canUseAuthentication(): boolean {
    return !!(this.tokenState.accessToken || this.tokenState.refreshToken || (this.username && this.password));
  }

  private hasUsableAccessToken(): boolean {
    if (!this.tokenState.accessToken) {
      return false;
    }

    if (!this.tokenState.accessTokenExpiresUtc) {
      return true;
    }

    return new Date() < this.tokenState.accessTokenExpiresUtc;
  }

  private shouldRefreshAccessToken(): boolean {
    const issued = this.tokenState.accessTokenIssuedUtc;
    const expires = this.tokenState.accessTokenExpiresUtc;

    if (!issued || !expires) {
      return false;
    }

    if (expires <= issued) {
      return true;
    }

    const refreshThreshold = new Date(issued.getTime() + (expires.getTime() - issued.getTime()) * 0.75);
    return new Date() >= refreshThreshold;
  }

  private async tryRefreshAuthentication(): Promise<boolean> {
    if (!this.tokenState.refreshToken && !this.password) {
      return false;
    }

    try {
      await this.getAuthTokenIfNecessary(true);
      return true;
    } catch (error) {
      if (error instanceof ChillSharpClientError) {
        return false;
      }

      throw error;
    }
  }

  private createCurrentTokenResponse(): JsonObject {
    return {
      AccessToken: this.tokenState.accessToken ?? '',
      AccessTokenIssuedUtc: this.formatDate(this.tokenState.accessTokenIssuedUtc),
      AccessTokenExpiresUtc: this.formatDate(this.tokenState.accessTokenExpiresUtc),
      RefreshToken: this.tokenState.refreshToken ?? '',
      RefreshTokenExpiresUtc: this.formatDate(this.tokenState.refreshTokenExpiresUtc),
      UserName: this.username ?? ''
    };
  }

  private buildChillUrl(relativeUrl: string): string {
    return `${this.baseUrl}/${relativeUrl.replace(/^\/+/, '')}`;
  }

  private buildAuthUrl(relativeUrl: string): string {
    const suffix = '/chill';
    if (this.baseUrl.toLowerCase().endsWith(suffix)) {
      return `${this.baseUrl.slice(0, -suffix.length)}/chill-auth/${relativeUrl.replace(/^\/+/, '')}`;
    }

    return `${this.baseUrl.replace(/\/$/, '')}-auth/${relativeUrl.replace(/^\/+/, '')}`;
  }

  private buildI18nUrl(relativeUrl: string): string {
    const suffix = '/chill';
    if (this.baseUrl.toLowerCase().endsWith(suffix)) {
      return `${this.baseUrl.slice(0, -suffix.length)}/chill-i18n/${relativeUrl.replace(/^\/+/, '')}`;
    }

    return `${this.baseUrl.replace(/\/$/, '')}-i18n/${relativeUrl.replace(/^\/+/, '')}`;
  }

  private normalizeRequiredValue(value: string, argumentName: string): string {
    const normalized = this.normalizeOptionalValue(value);
    if (!normalized) {
      throw new Error(`${argumentName} is required.`);
    }

    return normalized;
  }

  private normalizeOptionalValue(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private readString(payload: JsonObject, key: string): string | null {
    const value = payload[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private parseDate(value: JsonValue | undefined): Date | null {
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private formatDate(value: Date | null): string {
    return value ? value.toISOString() : '';
  }
}
