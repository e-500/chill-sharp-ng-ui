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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Inject, Injectable } from "@angular/core";
import { from, Observable } from "rxjs";
import { CHILL_SHARP_CLIENT } from "./tokens.js";
import { CHILL_SHARP_NG_CLIENT_VERSION } from "./version.js";
let ChillSharpNgClient = class ChillSharpNgClient {
    client;
    constructor(client) {
        this.client = client;
    }
    query(dtoQuery) {
        return from(this.client.query(dtoQuery));
    }
    lookup(dtoQuery) {
        return from(this.client.lookup(dtoQuery));
    }
    find(dtoEntity) {
        return from(this.client.find(dtoEntity));
    }
    create(dtoEntity) {
        return from(this.client.create(dtoEntity));
    }
    update(dtoEntity) {
        return from(this.client.update(dtoEntity));
    }
    delete(dtoEntity) {
        return from(this.client.delete(dtoEntity));
    }
    autocomplete(dto) {
        return from(this.client.autocomplete(dto));
    }
    validate(dto) {
        return from(this.client.validate(dto));
    }
    chunk(operations) {
        return from(this.client.chunk(operations));
    }
    uploadAttachment(targetEntity, file, options) {
        return from(this.client.uploadAttachment(targetEntity, file, options));
    }
    uploadAttachments(targetEntity, files, options) {
        return from(this.client.uploadAttachments(targetEntity, files, options));
    }
    getAttachments(targetEntity) {
        return from(this.client.getAttachments(targetEntity));
    }
    downloadAttachment(attachmentOrGuid) {
        return from(this.client.downloadAttachment(attachmentOrGuid));
    }
    version() {
        return CHILL_SHARP_NG_CLIENT_VERSION;
    }
    test() {
        return from(this.client.test());
    }
    getSchema(chillType, chillViewCode, cultureName) {
        return from(this.client.getSchema(chillType, chillViewCode, cultureName));
    }
    getSchemaList(cultureName) {
        return from(this.client.getSchemaList(cultureName));
    }
    setSchema(schema) {
        return from(this.client.setSchema(schema));
    }
    getEntityOptions(chillType) {
        return from(this.client.getEntityOptions(chillType));
    }
    setEntityOptions(entityOptions) {
        return from(this.client.setEntityOptions(entityOptions));
    }
    getMenu(parentGuid) {
        return from(this.client.getMenu(parentGuid));
    }
    setMenu(menuItem) {
        return from(this.client.setMenu(menuItem));
    }
    deleteMenu(menuItemGuid) {
        return from(this.client.deleteMenu(menuItemGuid));
    }
    getText(request) {
        return from(this.client.getText(request));
    }
    getTexts(requests) {
        return from(this.client.getTexts(requests));
    }
    setText(payload) {
        return from(this.client.setText(payload));
    }
    watchEntityChanges(chillType, guid) {
        return new Observable((subscriber) => {
            let remoteSubscription = null;
            let isClosed = false;
            void this.client
                .subscribeToEntityChanges(chillType, async (changes) => {
                subscriber.next(changes);
            }, guid)
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
        });
    }
    disconnectEntityChanges() {
        return from(this.client.disconnectEntityChanges());
    }
    registerAuthAccount(payload) {
        return from(this.client.registerAuthAccount(payload));
    }
    loginAuthAccount(payload) {
        return from(this.client.loginAuthAccount(payload));
    }
    refreshAuthAccount() {
        return from(this.client.refreshAuthAccount());
    }
    logoutAuthAccount() {
        return from(this.client.logoutAuthAccount());
    }
    changeAuthPassword(payload) {
        return from(this.client.changeAuthPassword(payload));
    }
    requestAuthPasswordReset(payload) {
        return from(this.client.requestAuthPasswordReset(payload));
    }
    resetAuthPassword(payload) {
        return from(this.client.resetAuthPassword(payload));
    }
    getAuthPermissions() {
        return from(this.client.getAuthPermissions());
    }
    getAuthUserList() {
        return from(this.client.getAuthUserList());
    }
    getAuthUser(userGuid) {
        return from(this.client.getAuthUser(userGuid));
    }
    setAuthUser(payload) {
        return from(this.client.setAuthUser(payload));
    }
    getAuthUsers() {
        return from(this.client.getAuthUsers());
    }
    createAuthUser(payload) {
        return from(this.client.createAuthUser(payload));
    }
    updateAuthUser(userGuid, payload) {
        return from(this.client.updateAuthUser(userGuid, payload));
    }
    deleteAuthUser(userGuid) {
        return from(this.client.deleteAuthUser(userGuid));
    }
    getAuthUserRoles(userGuid) {
        return from(this.client.getAuthUserRoles(userGuid));
    }
    assignAuthRole(userGuid, roleGuid) {
        return from(this.client.assignAuthRole(userGuid, roleGuid));
    }
    removeAuthRole(userGuid, roleGuid) {
        return from(this.client.removeAuthRole(userGuid, roleGuid));
    }
    getAuthRoleList() {
        return from(this.client.getAuthRoleList());
    }
    getAuthModuleList() {
        return from(this.client.getAuthModuleList());
    }
    getAuthEntityList(module) {
        return from(this.client.getAuthEntityList(module));
    }
    getAuthQueryList(module) {
        return from(this.client.getAuthQueryList(module));
    }
    getAuthModuleEntityList(module) {
        return from(this.client.getAuthModuleEntityList(module));
    }
    getAuthPropertyList(chillType) {
        return from(this.client.getAuthPropertyList(chillType));
    }
    getAuthRole(roleGuid) {
        return from(this.client.getAuthRole(roleGuid));
    }
    setAuthRole(payload) {
        return from(this.client.setAuthRole(payload));
    }
    getAuthRoles() {
        return from(this.client.getAuthRoles());
    }
    createAuthRole(payload) {
        return from(this.client.createAuthRole(payload));
    }
    updateAuthRole(roleGuid, payload) {
        return from(this.client.updateAuthRole(roleGuid, payload));
    }
    deleteAuthRole(roleGuid) {
        return from(this.client.deleteAuthRole(roleGuid));
    }
    getAuthPermissionRules(userGuid, roleGuid) {
        return from(this.client.getAuthPermissionRules(userGuid, roleGuid));
    }
    getAuthPermissionRule(ruleGuid) {
        return from(this.client.getAuthPermissionRule(ruleGuid));
    }
    createAuthPermissionRule(payload) {
        return from(this.client.createAuthPermissionRule(payload));
    }
    updateAuthPermissionRule(ruleGuid, payload) {
        return from(this.client.updateAuthPermissionRule(ruleGuid, payload));
    }
    deleteAuthPermissionRule(ruleGuid) {
        return from(this.client.deleteAuthPermissionRule(ruleGuid));
    }
    getRawClient() {
        return this.client;
    }
};
ChillSharpNgClient = __decorate([
    Injectable({
        providedIn: "root"
    }),
    __param(0, Inject(CHILL_SHARP_CLIENT))
], ChillSharpNgClient);
export { ChillSharpNgClient };
