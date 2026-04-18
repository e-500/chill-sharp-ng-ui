/*
 * ChillSharp is a lightweight .NET library that sits on top of Entity Framework Core
 * and turns an existing data model into a fully working REST API with almost no setup.
 * Copyright (C) 2025 Andrea Piovesan
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import { HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { ChillSharpClientError } from "./errors.js";
import { CHILL_SHARP_TS_CLIENT_VERSION } from "./version.js";
export const API_BASE_PATH = "api/";
export const ChillDtoPropertyType = {
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
};
export const PermissionEffect = {
    Allow: 1,
    Deny: 2
};
export const PermissionAction = {
    FullControl: 0,
    Query: 1,
    Create: 2,
    Update: 3,
    Delete: 4,
    See: 5,
    Modify: 6
};
export const PermissionScope = {
    Module: 1,
    Entity: 2,
    Property: 3
};
export class ChillSharpClient {
    static API_BASE_PATH = API_BASE_PATH;
    static attachmentEntityChillType = "ChillSharp.Attachment.Model.Attachment";
    static attachmentQueryChillType = "ChillSharp.Attachment.Query.AttachmentQuery";
    baseUrl;
    fetchImpl;
    cultureName;
    signalRWithCredentials;
    username;
    password;
    refreshPromise = null;
    tokenState;
    notificationConnection = null;
    entityChangeSubscriptions = new Map();
    entityChangeRegistrationCounts = new Map();
    entityChangeSubscriptionSequence = 0;
    constructor(baseUrl, options = {}) {
        this.baseUrl = this.normalizeBaseUrl(baseUrl, options.apiBasePath);
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.username = this.normalizeOptionalValue(options.username);
        this.password = this.normalizeOptionalValue(options.password);
        this.cultureName = this.normalizeOptionalValue(options.cultureName);
        this.signalRWithCredentials = options.signalRWithCredentials ?? true;
        this.tokenState = {
            accessToken: this.normalizeOptionalValue(options.accessToken),
            accessTokenIssuedUtc: null,
            accessTokenExpiresUtc: null,
            refreshToken: null,
            refreshTokenExpiresUtc: null
        };
    }
    query(dtoQuery) {
        return this.sendJson("POST", this.buildChillUrl("query"), dtoQuery);
    }
    lookup(dtoQuery) {
        return this.sendJson("POST", this.buildChillUrl("lookup"), dtoQuery);
    }
    find(dtoEntity) {
        return this.sendJson("POST", this.buildChillUrl("find"), dtoEntity);
    }
    create(dtoEntity) {
        return this.sendJson("POST", this.buildChillUrl("create"), dtoEntity);
    }
    update(dtoEntity) {
        return this.sendJson("POST", this.buildChillUrl("update"), dtoEntity);
    }
    async delete(dtoEntity) {
        await this.sendJson("POST", this.buildChillUrl("delete"), dtoEntity, false);
    }
    autocomplete(dto) {
        return this.sendJson("POST", this.buildChillUrl("autocomplete"), dto);
    }
    validate(dto) {
        return this.sendJson("POST", this.buildChillUrl("validate"), dto);
    }
    chunk(operations) {
        return this.sendJson("POST", this.buildChillUrl("chunk"), operations);
    }
    uploadAttachment(targetEntity, file, options = {}) {
        return this.uploadAttachments(targetEntity, [file], options);
    }
    async uploadAttachments(targetEntity, files, options = {}) {
        const target = this.getAttachmentTargetInfo(targetEntity);
        if (!Array.isArray(files) || files.length === 0) {
            throw new Error("files is required.");
        }
        const form = new FormData();
        form.append("attachToChillType", target.chillType);
        form.append("attachToGuid", target.guid);
        const normalizedTitle = this.normalizeOptionalValue(options.title ?? undefined);
        if (normalizedTitle) {
            form.append("title", normalizedTitle);
        }
        const normalizedDescription = this.normalizeOptionalValue(options.description ?? undefined);
        if (normalizedDescription) {
            form.append("description", normalizedDescription);
        }
        form.append("public", options.isPublic ? "true" : "false");
        for (const file of files) {
            form.append("file", this.toAttachmentBlob(file), this.normalizeRequiredValue(file.fileName, "file.fileName"));
        }
        return this.sendJson("POST", this.buildAttachmentUrl("attachment/upload"), form, true, false, false);
    }
    async getAttachments(targetEntity) {
        const target = this.getAttachmentTargetInfo(targetEntity);
        const response = await this.query({
            chillType: ChillSharpClient.attachmentQueryChillType,
            properties: {
                attachToChillType: target.chillType,
                attachToGuid: target.guid
            }
        });
        const results = this.readValue(response, "results");
        return Array.isArray(results)
            ? results.filter((item) => !!item && typeof item === "object" && !Array.isArray(item))
            : [];
    }
    downloadAttachment(attachmentOrGuid) {
        const attachmentGuid = typeof attachmentOrGuid === "string"
            ? this.normalizeRequiredValue(attachmentOrGuid, "attachmentGuid")
            : this.getAttachmentGuid(attachmentOrGuid);
        return this.sendBlob("GET", this.buildAttachmentUrl(`attachment/download?guid=${encodeURIComponent(attachmentGuid)}`), this.canUseAuthentication() ? false : true);
    }
    version() {
        return CHILL_SHARP_TS_CLIENT_VERSION;
    }
    test() {
        return this.sendText("GET", this.buildApiUrl("test"), true);
    }
    getSchema(chillType, chillViewCode, cultureName) {
        const encodedType = encodeURIComponent(this.normalizeRequiredValue(chillType, "chillType"));
        const encodedView = encodeURIComponent(this.normalizeRequiredValue(chillViewCode, "chillViewCode"));
        const effectiveCultureName = this.normalizeOptionalValue(cultureName) ?? this.cultureName;
        let relativeUrl = `get-schema?chillType=${encodedType}&chillViewCode=${encodedView}`;
        if (effectiveCultureName) {
            relativeUrl += `&cultureName=${encodeURIComponent(effectiveCultureName)}`;
        }
        return this.sendJson("GET", this.buildSchemaUrl(relativeUrl));
    }
    getSchemaList(cultureName) {
        const effectiveCultureName = this.normalizeOptionalValue(cultureName) ?? this.cultureName;
        let relativeUrl = "get-schema-list";
        if (effectiveCultureName) {
            relativeUrl += `?cultureName=${encodeURIComponent(effectiveCultureName)}`;
        }
        return this.sendJson("GET", this.buildSchemaUrl(relativeUrl));
    }
    setSchema(schema) {
        return this.sendJson("POST", this.buildSchemaUrl("set-schema"), schema);
    }
    getEntityOptions(chillType) {
        const encodedType = encodeURIComponent(this.normalizeRequiredValue(chillType, "chillType"));
        return this.sendJson("GET", this.buildSchemaUrl(`get-entity-options?chillType=${encodedType}`));
    }
    setEntityOptions(entityOptions) {
        return this.sendJson("POST", this.buildSchemaUrl("set-entity-options"), entityOptions);
    }
    getMenu(parentGuid) {
        const normalizedParentGuid = this.normalizeQueryValue(parentGuid);
        const suffix = normalizedParentGuid === null ? "" : `?parentGuid=${encodeURIComponent(normalizedParentGuid)}`;
        return this.sendJson("GET", this.buildSchemaUrl(`get-menu${suffix}`));
    }
    setMenu(menuItem) {
        return this.sendJson("POST", this.buildSchemaUrl("set-menu"), menuItem);
    }
    async deleteMenu(menuItemGuid) {
        const normalizedMenuItemGuid = this.normalizeRequiredValue(menuItemGuid, "menuItemGuid");
        await this.sendJson("DELETE", this.buildSchemaUrl(`delete-menu?menuItemGuid=${encodeURIComponent(normalizedMenuItemGuid)}`), undefined, false);
    }
    getText(request) {
        return this.sendJson("POST", this.buildI18nUrl("get-text"), this.prepareGetTextRequest(request), true, true);
    }
    getTexts(requests) {
        if (!Array.isArray(requests)) {
            throw new Error("requests is required.");
        }
        return this.sendJson("POST", this.buildI18nUrl("get-multiple-text"), requests.map((request) => this.prepareGetTextRequest(request)));
    }
    setText(payload) {
        return this.sendJson("PUT", this.buildI18nUrl("set-text"), payload);
    }
    async subscribeToEntityChanges(chillType, callback, guid) {
        if (typeof callback !== "function") {
            throw new Error("callback is required.");
        }
        const normalizedChillType = this.normalizeRequiredValue(chillType, "chillType");
        const normalizedGuid = this.normalizeOptionalValue(guid);
        const connection = await this.ensureNotificationConnection();
        const registrationKey = this.buildEntityChangeRegistrationKey(normalizedChillType, normalizedGuid);
        const registrationCount = this.entityChangeRegistrationCounts.get(registrationKey) ?? 0;
        if (registrationCount === 0) {
            await connection.invoke("Register", normalizedChillType, normalizedGuid);
        }
        this.entityChangeRegistrationCounts.set(registrationKey, registrationCount + 1);
        const subscriptionId = `entity-change-${++this.entityChangeSubscriptionSequence}`;
        this.entityChangeSubscriptions.set(subscriptionId, {
            id: subscriptionId,
            chillType: normalizedChillType,
            guid: normalizedGuid,
            callback
        });
        return {
            chillType: normalizedChillType,
            guid: normalizedGuid,
            unsubscribe: async () => {
                await this.unsubscribeFromEntityChanges(subscriptionId);
            }
        };
    }
    async disconnectEntityChanges() {
        this.entityChangeSubscriptions.clear();
        this.entityChangeRegistrationCounts.clear();
        if (!this.notificationConnection) {
            return;
        }
        const connection = this.notificationConnection;
        this.notificationConnection = null;
        await connection.stop();
    }
    async registerAuthAccount(payload) {
        const response = await this.sendAuthJson("POST", "register", payload, true, true);
        this.applyAuthToken(response, true);
        return response;
    }
    async loginAuthAccount(payload) {
        const response = await this.sendAuthJson("POST", "login", payload, true, true);
        this.applyAuthToken(response, true);
        return response;
    }
    refreshAuthAccount() {
        return this.getAuthTokenIfNecessary(true);
    }
    async logoutAuthAccount() {
        await this.sendAuthJson("POST", "logout", undefined, false);
        this.clearAuthToken();
    }
    changeAuthPassword(payload) {
        return this.sendAuthJson("POST", "change-password", payload);
    }
    requestAuthPasswordReset(payload) {
        return this.sendAuthJson("POST", "request-password-reset", payload, true, true);
    }
    resetAuthPassword(payload) {
        return this.sendAuthJson("POST", "reset-password", payload, true, true);
    }
    getAuthPermissions() {
        return this.sendAuthJson("GET", "get-permissions");
    }
    getAuthUserList() {
        return this.sendAuthJson("GET", "get-user-list");
    }
    async getAuthUser(userGuid) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        const [user, roles, permissions] = await Promise.all([
            this.sendAuthJson("GET", `users/${encodeURIComponent(normalizedUserGuid)}`),
            this.getAuthUserRoles(normalizedUserGuid),
            this.getAuthPermissionRules(normalizedUserGuid, null)
        ]);
        return {
            ...user,
            roles,
            permissions
        };
    }
    async setAuthUser(payload) {
        const userGuid = this.normalizeOptionalValue(payload.guid);
        const basePayload = {
            externalId: payload.externalId,
            userName: payload.userName,
            displayName: payload.displayName,
            displayCultureName: payload.displayCultureName,
            displayTimeZone: payload.displayTimeZone,
            displayDateFormat: payload.displayDateFormat,
            displayNumberFormat: payload.displayNumberFormat,
            isActive: payload.isActive,
            canManagePermissions: payload.canManagePermissions,
            canManageSchema: payload.canManageSchema,
            menuHierarchy: payload.menuHierarchy
        };
        const user = userGuid
            ? await this.updateAuthUser(userGuid, basePayload)
            : await this.createAuthUser({
                ...basePayload,
                email: "",
                externalId: payload.externalId
            });
        if (!user) {
            throw new ChillSharpClientError("Auth user was not found after setAuthUser execution.");
        }
        await this.syncUserRoles(user.guid, payload.roleGuids);
        await this.syncUserPermissions(user.guid, payload.permissions);
        return this.getAuthUser(user.guid);
    }
    getAuthRoleList() {
        return this.sendAuthJson("GET", "get-role-list");
    }
    getAuthModuleList() {
        return this.sendAuthJson("GET", "get-module-list");
    }
    getAuthEntityList(module) {
        const normalizedModule = this.normalizeQueryValue(module);
        const suffix = normalizedModule === null ? "" : `?module=${encodeURIComponent(normalizedModule)}`;
        return this.sendAuthJson("GET", `get-entity-list${suffix}`);
    }
    getAuthQueryList(module) {
        const normalizedModule = this.normalizeQueryValue(module);
        const suffix = normalizedModule === null ? "" : `?module=${encodeURIComponent(normalizedModule)}`;
        return this.sendAuthJson("GET", `get-query-list${suffix}`);
    }
    getAuthModuleEntityList(module) {
        return this.getAuthEntityList(module);
    }
    getAuthPropertyList(chillType) {
        const normalizedChillType = this.normalizeRequiredValue(chillType, "chillType");
        return this.sendAuthJson("GET", `get-property-list?chillType=${encodeURIComponent(normalizedChillType)}`);
    }
    async getAuthRole(roleGuid) {
        const normalizedRoleGuid = this.normalizeRequiredValue(roleGuid, "roleGuid");
        const [role, permissions, users] = await Promise.all([
            this.sendAuthJson("GET", `roles/${encodeURIComponent(normalizedRoleGuid)}`),
            this.getAuthPermissionRules(null, normalizedRoleGuid),
            this.getUsersAssignedToRole(normalizedRoleGuid)
        ]);
        return {
            ...role,
            users,
            permissions
        };
    }
    async setAuthRole(payload) {
        const roleGuid = this.normalizeOptionalValue(payload.guid);
        const basePayload = {
            name: payload.name,
            description: payload.description,
            isActive: payload.isActive,
            menuHierarchy: payload.menuHierarchy
        };
        const role = roleGuid
            ? await this.updateAuthRole(roleGuid, basePayload)
            : await this.createAuthRole(basePayload);
        if (!role) {
            throw new ChillSharpClientError("Auth role was not found after setAuthRole execution.");
        }
        await this.syncRoleUsers(role.guid, payload.userGuids);
        await this.syncRolePermissions(role.guid, payload.permissions);
        return this.getAuthRole(role.guid);
    }
    getAuthUsers() {
        return this.sendAuthJson("GET", "users");
    }
    createAuthUser(payload) {
        return this.sendAuthJson("POST", "users", payload);
    }
    updateAuthUser(userGuid, payload) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        return this.sendAuthJson("PUT", `users/${encodeURIComponent(normalizedUserGuid)}`, payload);
    }
    async deleteAuthUser(userGuid) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        await this.sendAuthJson("DELETE", `users/${encodeURIComponent(normalizedUserGuid)}`, undefined, false);
    }
    getAuthUserRoles(userGuid) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        return this.sendAuthJson("GET", `users/${encodeURIComponent(normalizedUserGuid)}/roles`);
    }
    async assignAuthRole(userGuid, roleGuid) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        const normalizedRoleGuid = this.normalizeRequiredValue(roleGuid, "roleGuid");
        await this.sendAuthJson("PUT", `users/${encodeURIComponent(normalizedUserGuid)}/roles/${encodeURIComponent(normalizedRoleGuid)}`, undefined, false);
    }
    async removeAuthRole(userGuid, roleGuid) {
        const normalizedUserGuid = this.normalizeRequiredValue(userGuid, "userGuid");
        const normalizedRoleGuid = this.normalizeRequiredValue(roleGuid, "roleGuid");
        await this.sendAuthJson("DELETE", `users/${encodeURIComponent(normalizedUserGuid)}/roles/${encodeURIComponent(normalizedRoleGuid)}`, undefined, false);
    }
    getAuthRoles() {
        return this.sendAuthJson("GET", "roles");
    }
    createAuthRole(payload) {
        return this.sendAuthJson("POST", "roles", payload);
    }
    updateAuthRole(roleGuid, payload) {
        const normalizedRoleGuid = this.normalizeRequiredValue(roleGuid, "roleGuid");
        return this.sendAuthJson("PUT", `roles/${encodeURIComponent(normalizedRoleGuid)}`, payload);
    }
    async deleteAuthRole(roleGuid) {
        const normalizedRoleGuid = this.normalizeRequiredValue(roleGuid, "roleGuid");
        await this.sendAuthJson("DELETE", `roles/${encodeURIComponent(normalizedRoleGuid)}`, undefined, false);
    }
    getAuthPermissionRules(userGuid, roleGuid) {
        const queryParts = [];
        const normalizedUserGuid = this.normalizeOptionalValue(userGuid);
        const normalizedRoleGuid = this.normalizeOptionalValue(roleGuid);
        if (normalizedUserGuid) {
            queryParts.push(`userGuid=${encodeURIComponent(normalizedUserGuid)}`);
        }
        if (normalizedRoleGuid) {
            queryParts.push(`roleGuid=${encodeURIComponent(normalizedRoleGuid)}`);
        }
        const suffix = queryParts.length === 0 ? "" : `?${queryParts.join("&")}`;
        return this.sendAuthJson("GET", `permissions${suffix}`);
    }
    getAuthPermissionRule(ruleGuid) {
        const normalizedRuleGuid = this.normalizeRequiredValue(ruleGuid, "ruleGuid");
        return this.sendAuthJson("GET", `permissions/${encodeURIComponent(normalizedRuleGuid)}`);
    }
    createAuthPermissionRule(payload) {
        return this.sendAuthJson("POST", "permissions", payload);
    }
    updateAuthPermissionRule(ruleGuid, payload) {
        const normalizedRuleGuid = this.normalizeRequiredValue(ruleGuid, "ruleGuid");
        return this.sendAuthJson("PUT", `permissions/${encodeURIComponent(normalizedRuleGuid)}`, payload);
    }
    async deleteAuthPermissionRule(ruleGuid) {
        const normalizedRuleGuid = this.normalizeRequiredValue(ruleGuid, "ruleGuid");
        await this.sendAuthJson("DELETE", `permissions/${encodeURIComponent(normalizedRuleGuid)}`, undefined, false);
    }
    prepareGetTextRequest(request) {
        if (!request || typeof request !== "object") {
            throw new Error("request is required.");
        }
        const effectiveCultureName = this.normalizeOptionalValue(this.readString(request, "cultureName")) ?? this.cultureName;
        if (!effectiveCultureName) {
            throw new Error("cultureName is required.");
        }
        return {
            labelGuid: this.normalizeRequiredValue(this.readString(request, "labelGuid"), "labelGuid"),
            cultureName: effectiveCultureName,
            primaryCultureName: this.readString(request, "primaryCultureName") ?? "",
            primaryDefaultText: this.readString(request, "primaryDefaultText") ?? "",
            secondaryCultureName: this.readString(request, "secondaryCultureName") ?? "",
            secondaryDefaultText: this.readString(request, "secondaryDefaultText") ?? ""
        };
    }
    sendAuthJson(method, relativeUrl, payload, expectResponseBody = true, allowAnonymous = false) {
        return this.sendJson(method, this.buildAuthUrl(relativeUrl), payload, expectResponseBody, allowAnonymous);
    }
    async sendJson(method, url, payload, expectResponseBody = true, allowAnonymous = false, allowRetry = true) {
        const response = await this.sendRequest(method, url, payload, allowAnonymous, allowRetry);
        if (!expectResponseBody) {
            return null;
        }
        const text = await response.text();
        if (!text.trim()) {
            return null;
        }
        return JSON.parse(text);
    }
    async sendText(method, url, allowAnonymous = false, allowRetry = true) {
        const response = await this.sendRequest(method, url, undefined, allowAnonymous, allowRetry);
        return await response.text();
    }
    async sendBlob(method, url, allowAnonymous = false, allowRetry = true) {
        const response = await this.sendRequest(method, url, undefined, allowAnonymous, allowRetry);
        return await response.blob();
    }
    async sendRequest(method, url, payload, allowAnonymous = false, allowRetry = true) {
        try {
            if (!allowAnonymous && this.canUseAuthentication()) {
                await this.getAuthTokenIfNecessary();
            }
            const headers = new Headers();
            if (!allowAnonymous && this.tokenState.accessToken) {
                headers.set("Authorization", `Bearer ${this.tokenState.accessToken}`);
            }
            if (payload !== undefined && !this.isFormDataPayload(payload)) {
                headers.set("Content-Type", "application/json");
            }
            const response = await this.fetchImpl(url, {
                method,
                headers,
                body: payload === undefined
                    ? undefined
                    : this.isFormDataPayload(payload)
                        ? payload
                        : JSON.stringify(payload)
            });
            if ((response.status === 401 || response.status === 403) && !allowAnonymous && allowRetry && await this.tryRefreshAuthentication()) {
                return this.sendRequest(method, url, payload, allowAnonymous, false);
            }
            if (!response.ok) {
                throw new ChillSharpClientError(`HTTP ${response.status} calling ${method} ${url}`, response.status, await response.text());
            }
            return response;
        }
        catch (error) {
            if (error instanceof ChillSharpClientError) {
                throw error;
            }
            throw new ChillSharpClientError(`Unexpected error executing ${method} ${url}`, undefined, undefined, error);
        }
    }
    async getAuthTokenIfNecessary(forceRefresh = false) {
        if (this.refreshPromise) {
            return this.refreshPromise;
        }
        this.refreshPromise = this.getAuthTokenIfNecessaryCore(forceRefresh);
        try {
            return await this.refreshPromise;
        }
        finally {
            this.refreshPromise = null;
        }
    }
    async getAuthTokenIfNecessaryCore(forceRefresh) {
        if (!forceRefresh && this.hasUsableAccessToken() && !this.shouldRefreshAccessToken()) {
            return this.createCurrentTokenResponse();
        }
        if (this.tokenState.refreshToken && (!forceRefresh || !this.password)) {
            try {
                const refreshed = await this.sendAuthJson("POST", "refresh", { refreshToken: this.tokenState.refreshToken }, true, true);
                this.applyAuthToken(refreshed, true);
                return refreshed;
            }
            catch (error) {
                if (!(error instanceof ChillSharpClientError)) {
                    throw error;
                }
                this.tokenState.refreshToken = null;
                this.tokenState.refreshTokenExpiresUtc = null;
            }
        }
        if (this.username && this.password) {
            const token = await this.sendAuthJson("POST", "login", {
                userNameOrEmail: this.username,
                password: this.password
            }, true, true);
            this.applyAuthToken(token, true);
            return token;
        }
        if (this.hasUsableAccessToken()) {
            return this.createCurrentTokenResponse();
        }
        throw new ChillSharpClientError("No auth token is available and the client cannot obtain a new one.");
    }
    applyAuthToken(payload, forgetPassword) {
        this.tokenState.accessToken = this.readString(payload, "accessToken");
        this.tokenState.accessTokenIssuedUtc = this.readDate(payload, "accessTokenIssuedUtc");
        this.tokenState.accessTokenExpiresUtc = this.readDate(payload, "accessTokenExpiresUtc");
        this.tokenState.refreshToken = this.readString(payload, "refreshToken");
        this.tokenState.refreshTokenExpiresUtc = this.readDate(payload, "refreshTokenExpiresUtc");
        const userName = this.readString(payload, "userName");
        if (userName) {
            this.username = userName;
        }
        if (forgetPassword) {
            this.password = null;
        }
    }
    clearAuthToken() {
        this.tokenState.accessToken = null;
        this.tokenState.accessTokenIssuedUtc = null;
        this.tokenState.accessTokenExpiresUtc = null;
        this.tokenState.refreshToken = null;
        this.tokenState.refreshTokenExpiresUtc = null;
    }
    canUseAuthentication() {
        return !!(this.tokenState.accessToken || this.tokenState.refreshToken || (this.username && this.password));
    }
    hasUsableAccessToken() {
        if (!this.tokenState.accessToken) {
            return false;
        }
        if (!this.tokenState.accessTokenExpiresUtc) {
            return true;
        }
        return new Date() < this.tokenState.accessTokenExpiresUtc;
    }
    shouldRefreshAccessToken() {
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
    async tryRefreshAuthentication() {
        if (!this.tokenState.refreshToken && !this.password) {
            return false;
        }
        try {
            await this.getAuthTokenIfNecessary(true);
            return true;
        }
        catch (error) {
            if (error instanceof ChillSharpClientError) {
                return false;
            }
            throw error;
        }
    }
    createCurrentTokenResponse() {
        return {
            accessToken: this.tokenState.accessToken ?? "",
            accessTokenIssuedUtc: this.formatDate(this.tokenState.accessTokenIssuedUtc),
            accessTokenExpiresUtc: this.formatDate(this.tokenState.accessTokenExpiresUtc),
            refreshToken: this.tokenState.refreshToken ?? "",
            refreshTokenExpiresUtc: this.formatDate(this.tokenState.refreshTokenExpiresUtc),
            userId: "",
            userName: this.username ?? ""
        };
    }
    buildChillUrl(relativeUrl) {
        return `${this.baseUrl}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    buildNotifyUrl() {
        return `${this.getApiBaseUrl().replace(/\/$/, "")}/notify`;
    }
    buildApiUrl(relativeUrl) {
        return `${this.getApiBaseUrl().replace(/\/$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    buildAuthUrl(relativeUrl) {
        return `${this.getAuthBaseUrl().replace(/\/$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    buildSchemaUrl(relativeUrl) {
        return `${this.getSchemaBaseUrl().replace(/\/$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    buildI18nUrl(relativeUrl) {
        return `${this.getI18nBaseUrl().replace(/\/$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    buildAttachmentUrl(relativeUrl) {
        return `${this.getAttachmentBaseUrl().replace(/\/$/, "")}/${relativeUrl.replace(/^\/+/, "")}`;
    }
    getAuthBaseUrl() {
        const suffix = "/chill";
        if (this.baseUrl.toLowerCase().endsWith(suffix)) {
            return `${this.baseUrl.slice(0, -suffix.length)}/chill-auth`;
        }
        return `${this.baseUrl.replace(/\/$/, "")}-auth`;
    }
    getSchemaBaseUrl() {
        const suffix = "/chill";
        if (this.baseUrl.toLowerCase().endsWith(suffix)) {
            return `${this.baseUrl.slice(0, -suffix.length)}/chill-schema`;
        }
        return `${this.baseUrl.replace(/\/$/, "")}-schema`;
    }
    getI18nBaseUrl() {
        const suffix = "/chill";
        if (this.baseUrl.toLowerCase().endsWith(suffix)) {
            return `${this.baseUrl.slice(0, -suffix.length)}/chill-i18n`;
        }
        return `${this.baseUrl.replace(/\/$/, "")}-i18n`;
    }
    getAttachmentBaseUrl() {
        const suffix = "/chill";
        if (this.baseUrl.toLowerCase().endsWith(suffix)) {
            return `${this.baseUrl.slice(0, -suffix.length)}/chill-attachment`;
        }
        return `${this.baseUrl.replace(/\/$/, "")}-attachment`;
    }
    getApiBaseUrl() {
        const suffix = "/chill";
        if (this.baseUrl.toLowerCase().endsWith(suffix)) {
            return this.baseUrl.slice(0, -suffix.length);
        }
        return this.baseUrl.replace(/\/$/, "");
    }
    normalizeBaseUrl(baseUrl, apiBasePath) {
        const normalized = this.normalizeRequiredValue(baseUrl, "baseUrl").replace(/\/+$/, "");
        if (this.isKnownChillSharpEndpointBase(normalized)) {
            return normalized;
        }
        const normalizedApiBasePath = this.normalizeApiBasePath(apiBasePath);
        if (!normalizedApiBasePath) {
            return `${normalized}/chill`;
        }
        if (this.endsWithPathSegment(normalized, normalizedApiBasePath)) {
            return `${normalized}/chill`;
        }
        return `${normalized}/${normalizedApiBasePath}/chill`;
    }
    normalizeApiBasePath(apiBasePath) {
        const normalized = this.normalizeOptionalValue(apiBasePath) ?? API_BASE_PATH;
        return normalized.replace(/^\/+|\/+$/g, "");
    }
    isKnownChillSharpEndpointBase(baseUrl) {
        const lowerBaseUrl = baseUrl.toLowerCase();
        return lowerBaseUrl.endsWith("/chill") ||
            lowerBaseUrl.endsWith("/chill-auth") ||
            lowerBaseUrl.endsWith("/chill-schema") ||
            lowerBaseUrl.endsWith("/chill-i18n") ||
            lowerBaseUrl.endsWith("/chill-attachment");
    }
    endsWithPathSegment(value, segment) {
        return value.toLowerCase().endsWith(`/${segment.toLowerCase()}`);
    }
    normalizeRequiredValue(value, argumentName) {
        const normalized = this.normalizeOptionalValue(value);
        if (!normalized) {
            throw new Error(`${argumentName} is required.`);
        }
        return normalized;
    }
    normalizeOptionalValue(value) {
        const normalized = value?.trim();
        return normalized ? normalized : null;
    }
    normalizeQueryValue(value) {
        return value == null ? null : value.trim();
    }
    readString(payload, key) {
        const value = this.readValue(payload, key);
        return typeof value === "string" && value.trim() ? value.trim() : null;
    }
    readDate(payload, key) {
        return this.parseDate(this.readValue(payload, key));
    }
    readValue(payload, key) {
        if (key in payload) {
            return payload[key];
        }
        const pascalKey = key.length > 1
            ? `${key[0].toUpperCase()}${key.slice(1)}`
            : key.toUpperCase();
        if (pascalKey in payload) {
            return payload[pascalKey];
        }
        const matchedKey = Object.keys(payload).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
        return matchedKey ? payload[matchedKey] : undefined;
    }
    getAttachmentTargetInfo(targetEntity) {
        const guid = this.readString(targetEntity, "guid");
        if (!guid) {
            throw new Error("targetEntity.guid is required.");
        }
        const chillType = this.readString(targetEntity, "chillType");
        if (!chillType) {
            throw new Error("targetEntity.chillType is required.");
        }
        return {
            guid,
            chillType
        };
    }
    getAttachmentGuid(attachmentEntity) {
        const guid = this.readString(attachmentEntity, "guid");
        if (!guid) {
            throw new Error("attachmentEntity.guid is required.");
        }
        const chillType = this.readString(attachmentEntity, "chillType");
        if (chillType && chillType !== ChillSharpClient.attachmentEntityChillType) {
            const normalizedChillType = chillType.split(".").pop() ?? chillType;
            const normalizedAttachmentType = ChillSharpClient.attachmentEntityChillType.split(".").pop() ?? ChillSharpClient.attachmentEntityChillType;
            if (normalizedChillType !== normalizedAttachmentType) {
                throw new Error("attachmentEntity must point to an attachment.");
            }
        }
        return guid;
    }
    toAttachmentBlob(file) {
        if (!file || typeof file !== "object") {
            throw new Error("file is required.");
        }
        const contentType = this.normalizeOptionalValue(file.contentType) ?? "application/octet-stream";
        if (file.content instanceof Blob) {
            return file.content;
        }
        if (typeof file.content === "string" || file.content instanceof ArrayBuffer) {
            return new Blob([file.content], { type: contentType });
        }
        if (file.content instanceof Uint8Array) {
            const buffer = file.content.buffer.slice(file.content.byteOffset, file.content.byteOffset + file.content.byteLength);
            return new Blob([buffer], { type: contentType });
        }
        return new Blob([String(file.content)], { type: contentType });
    }
    isFormDataPayload(payload) {
        return typeof FormData !== "undefined" && payload instanceof FormData;
    }
    parseDate(value) {
        if (typeof value !== "string" || !value.trim()) {
            return null;
        }
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    formatDate(value) {
        return value ? value.toISOString() : "";
    }
    async ensureNotificationConnection() {
        if (this.notificationConnection) {
            if (this.notificationConnection.state === HubConnectionState.Disconnected) {
                await this.notificationConnection.start();
            }
            return this.notificationConnection;
        }
        const connection = new HubConnectionBuilder()
            .withUrl(this.buildNotifyUrl(), {
            withCredentials: this.signalRWithCredentials,
            accessTokenFactory: async () => {
                if (this.canUseAuthentication()) {
                    await this.getAuthTokenIfNecessary();
                }
                return this.tokenState.accessToken ?? "";
            }
        })
            .withAutomaticReconnect()
            .build();
        connection.on("EntitiesChanged", (payload) => {
            void this.dispatchEntityChangeNotifications(payload);
        });
        connection.onreconnected(async () => {
            await this.reregisterEntityChangeSubscriptions();
        });
        await connection.start();
        this.notificationConnection = connection;
        return connection;
    }
    async unsubscribeFromEntityChanges(subscriptionId) {
        const subscription = this.entityChangeSubscriptions.get(subscriptionId);
        if (!subscription) {
            return;
        }
        this.entityChangeSubscriptions.delete(subscriptionId);
        const registrationKey = this.buildEntityChangeRegistrationKey(subscription.chillType, subscription.guid);
        const registrationCount = this.entityChangeRegistrationCounts.get(registrationKey) ?? 0;
        if (registrationCount <= 1) {
            this.entityChangeRegistrationCounts.delete(registrationKey);
            const connection = this.notificationConnection;
            if (connection && connection.state === HubConnectionState.Connected) {
                await connection.invoke("Unregister", subscription.chillType, subscription.guid);
            }
        }
        else {
            this.entityChangeRegistrationCounts.set(registrationKey, registrationCount - 1);
        }
    }
    async dispatchEntityChangeNotifications(payload) {
        const notifications = this.normalizeEntityChangeNotifications(payload);
        if (notifications.length === 0) {
            return;
        }
        for (const subscription of this.entityChangeSubscriptions.values()) {
            const matchingChanges = notifications.filter((change) => change.chillType === subscription.chillType &&
                (!subscription.guid || change.guid === subscription.guid));
            if (matchingChanges.length === 0) {
                continue;
            }
            await subscription.callback(matchingChanges);
        }
    }
    normalizeEntityChangeNotifications(payload) {
        if (!Array.isArray(payload)) {
            return [];
        }
        return payload
            .filter((entry) => !!entry && typeof entry === "object" && !Array.isArray(entry))
            .map((entry) => {
            const chillType = this.readString(entry, "chillType");
            const guid = this.readString(entry, "guid");
            const action = this.readString(entry, "action");
            if (!chillType || !guid || !this.isEntityChangeAction(action)) {
                return null;
            }
            return {
                chillType,
                guid,
                action
            };
        })
            .filter((entry) => entry !== null);
    }
    isEntityChangeAction(value) {
        return value === "CREATED" || value === "UPDATED" || value === "DELETED";
    }
    async reregisterEntityChangeSubscriptions() {
        const connection = this.notificationConnection;
        if (!connection || connection.state !== HubConnectionState.Connected) {
            return;
        }
        for (const registrationKey of this.entityChangeRegistrationCounts.keys()) {
            const separatorIndex = registrationKey.indexOf("|");
            const chillType = separatorIndex >= 0 ? registrationKey.slice(0, separatorIndex) : registrationKey;
            const guid = separatorIndex >= 0 ? registrationKey.slice(separatorIndex + 1) : "";
            await connection.invoke("Register", chillType, guid || null);
        }
    }
    buildEntityChangeRegistrationKey(chillType, guid) {
        return `${chillType}|${guid ?? ""}`;
    }
    async getUsersAssignedToRole(roleGuid) {
        const users = await this.getAuthUsers();
        const matches = await Promise.all(users.map(async (user) => {
            const roles = await this.getAuthUserRoles(user.guid);
            return roles.some((role) => role.guid === roleGuid) ? user : null;
        }));
        return matches.filter((user) => user !== null);
    }
    async syncUserRoles(userGuid, roleGuids) {
        const desiredRoleGuids = new Set(roleGuids.map((roleGuid) => this.normalizeRequiredValue(roleGuid, "roleGuid")));
        const currentRoles = await this.getAuthUserRoles(userGuid);
        const currentRoleGuids = new Set(currentRoles.map((role) => role.guid));
        for (const roleGuid of desiredRoleGuids) {
            if (!currentRoleGuids.has(roleGuid)) {
                await this.assignAuthRole(userGuid, roleGuid);
            }
        }
        for (const role of currentRoles) {
            if (!desiredRoleGuids.has(role.guid)) {
                await this.removeAuthRole(userGuid, role.guid);
            }
        }
    }
    async syncUserPermissions(userGuid, permissions) {
        const currentRules = await this.getAuthPermissionRules(userGuid, null);
        await this.syncPermissionRules(currentRules, permissions, (permission) => ({
            userGuid,
            roleGuid: null,
            effect: permission.effect,
            action: permission.action,
            scope: permission.scope,
            module: permission.module,
            entityName: permission.entityName,
            propertyName: permission.propertyName,
            appliesToAllProperties: permission.appliesToAllProperties,
            description: permission.description
        }), (payload) => this.createAuthPermissionRule(payload), (guid, payload) => this.updateAuthPermissionRule(guid, payload), (guid) => this.deleteAuthPermissionRule(guid));
    }
    async syncRoleUsers(roleGuid, userGuids) {
        const desiredUserGuids = new Set(userGuids.map((userGuid) => this.normalizeRequiredValue(userGuid, "userGuid")));
        const currentUsers = await this.getUsersAssignedToRole(roleGuid);
        const currentUserGuids = new Set(currentUsers.map((user) => user.guid));
        for (const userGuid of desiredUserGuids) {
            if (!currentUserGuids.has(userGuid)) {
                await this.assignAuthRole(userGuid, roleGuid);
            }
        }
        for (const user of currentUsers) {
            if (!desiredUserGuids.has(user.guid)) {
                await this.removeAuthRole(user.guid, roleGuid);
            }
        }
    }
    async syncRolePermissions(roleGuid, permissions) {
        const currentRules = await this.getAuthPermissionRules(null, roleGuid);
        await this.syncPermissionRules(currentRules, permissions, (permission) => ({
            userGuid: null,
            roleGuid,
            effect: permission.effect,
            action: permission.action,
            scope: permission.scope,
            module: permission.module,
            entityName: permission.entityName,
            propertyName: permission.propertyName,
            appliesToAllProperties: permission.appliesToAllProperties,
            description: permission.description
        }), (payload) => this.createAuthPermissionRule(payload), (guid, payload) => this.updateAuthPermissionRule(guid, payload), (guid) => this.deleteAuthPermissionRule(guid));
    }
    async syncPermissionRules(currentRules, desiredRules, toPayload, createRule, updateRule, deleteRule) {
        const desiredByGuid = new Map();
        const newRules = [];
        for (const permission of desiredRules) {
            const guid = this.normalizeOptionalValue(permission.guid);
            if (guid) {
                desiredByGuid.set(guid, permission);
            }
            else {
                newRules.push(permission);
            }
        }
        for (const currentRule of currentRules) {
            const desiredRule = desiredByGuid.get(currentRule.guid);
            if (!desiredRule) {
                await deleteRule(currentRule.guid);
                continue;
            }
            await updateRule(currentRule.guid, toPayload(desiredRule));
            desiredByGuid.delete(currentRule.guid);
        }
        for (const desiredRule of desiredByGuid.values()) {
            await createRule(toPayload(desiredRule));
        }
        for (const desiredRule of newRules) {
            await createRule(toPayload(desiredRule));
        }
    }
}
