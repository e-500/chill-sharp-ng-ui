import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../../lib/chill-i18n-button-label.component';
import type {
  AuthPermissionRule,
  AuthRole,
  AuthUser,
  EditableAuthPermissionRule
} from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';
import { PermissionEditorComponent, type PermissionEditorRow } from './permission-editor.component';

@Component({
  selector: 'app-user-permission',
  standalone: true,
  imports: [CommonModule, FormsModule, PermissionEditorComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  templateUrl: './user-permission.component.html',
  styleUrl: './permission-editor.component.scss'
})
export class UserPermissionComponent {
  readonly chill = inject(ChillService);
  readonly users = input<AuthUser[]>([]);
  readonly roles = input<AuthRole[]>([]);

  readonly searchTerm = signal('');
  readonly selectedUserGuid = signal('');
  readonly isLoadingDetails = signal(false);
  readonly isSaving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly selectedRoleGuids = signal<string[]>([]);
  readonly permissionRows = signal<PermissionEditorRow[]>([]);
  readonly originalSnapshot = signal('');
  readonly selectionVersion = signal(0);

  readonly filteredUsers = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    if (!query) {
      return this.users();
    }

    return this.users().filter((user) => {
      const haystack = [
        user.displayName,
        user.userName,
        user.externalId,
        user.guid
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  });

  readonly selectedUser = computed(() =>
    this.users().find((user) => user.guid === this.selectedUserGuid()) ?? null
  );

  readonly hasSelection = computed(() => !!this.selectedUser());
  readonly hasChanges = computed(() => {
    if (!this.selectedUser()) {
      return false;
    }

    return this.serializeSnapshot() !== this.originalSnapshot();
  });

  readonly saveDisabled = computed(() =>
    this.isSaving() || this.isLoadingDetails() || !this.selectedUser() || !this.hasChanges()
  );

  constructor() {
    effect(() => {
      const users = this.users();
      const selectedUserGuid = this.selectedUserGuid();
      if (users.length === 0) {
        this.selectedUserGuid.set('');
        this.selectedRoleGuids.set([]);
        this.permissionRows.set([]);
        this.originalSnapshot.set('');
        return;
      }

      if (!selectedUserGuid || !users.some((user) => user.guid === selectedUserGuid)) {
        this.selectUser(users[0].guid);
      }
    });
  }

  selectUser(userGuid: string): void {
    if (!userGuid || this.selectedUserGuid() === userGuid) {
      return;
    }

    this.selectedUserGuid.set(userGuid);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loadSelectedUser(userGuid);
  }

  updateSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  toggleRole(roleGuid: string, checked: boolean): void {
    const current = new Set(this.selectedRoleGuids());
    if (checked) {
      current.add(roleGuid);
    } else {
      current.delete(roleGuid);
    }

    this.selectedRoleGuids.set([...current]);
  }

  updatePermissionRows(rows: PermissionEditorRow[]): void {
    this.permissionRows.set(rows);
  }

  save(): void {
    const user = this.selectedUser();
    if (!user || this.saveDisabled()) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.saveAuthUserAccess(
      user.guid,
      this.selectedRoleGuids(),
      this.permissionRows().map((row) => this.toPermissionPayload(row))
    ).subscribe({
      next: (response) => {
        this.selectedRoleGuids.set(response.roles.map((role) => role.guid));
        this.permissionRows.set(response.permissions.map((permission) => this.toPermissionRow(permission)));
        this.originalSnapshot.set(this.serializeSnapshot());
        this.isSaving.set(false);
        this.successMessage.set(this.chill.T('7F2F0CE1-88D9-4EF7-B7EA-2A729986AB27', 'User permissions updated.', 'Permessi utente aggiornati.'));
      },
      error: (error: unknown) => {
        this.isSaving.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  userLabel(user: AuthUser): string {
    return user.displayName?.trim() || user.userName?.trim() || user.externalId?.trim() || user.guid;
  }

  private loadSelectedUser(userGuid: string): void {
    this.isLoadingDetails.set(true);
    this.permissionRows.set([]);
    this.selectedRoleGuids.set([]);

    this.chill.getAuthUserAccess(userGuid).subscribe({
      next: (response) => {
        this.selectionVersion.update((value) => value + 1);
        this.selectedRoleGuids.set(response.roles.map((role) => role.guid));
        this.permissionRows.set(response.permissions.map((permission) => this.toPermissionRow(permission)));
        this.originalSnapshot.set(this.serializeSnapshot());
        this.isLoadingDetails.set(false);
      },
      error: (error: unknown) => {
        this.isLoadingDetails.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private toPermissionRow(permission: AuthPermissionRule): PermissionEditorRow {
    return {
      localId: permission.guid || `existing-${this.selectionVersion()}-${crypto.randomUUID()}`,
      guid: permission.guid,
      effect: permission.effect,
      action: permission.action,
      scope: permission.scope,
      module: permission.module,
      entityName: permission.entityName ?? '',
      propertyName: permission.propertyName ?? '',
      appliesToAllProperties: permission.appliesToAllProperties,
      description: permission.description
    };
  }

  private toPermissionPayload(row: PermissionEditorRow): EditableAuthPermissionRule {
    const propertyName = row.appliesToAllProperties
      ? undefined
      : row.propertyName?.trim() || undefined;

    return {
      guid: row.guid?.trim() || undefined,
      effect: row.effect,
      action: row.action,
      scope: row.scope,
      module: row.module.trim(),
      entityName: row.entityName?.trim() || '',
      propertyName,
      appliesToAllProperties: row.appliesToAllProperties,
      description: row.description.trim()
    };
  }

  private serializeSnapshot(): string {
    return JSON.stringify({
      roleGuids: [...this.selectedRoleGuids()].sort(),
      permissions: this.permissionRows().map((row) => this.toPermissionPayload(row))
    });
  }
}
