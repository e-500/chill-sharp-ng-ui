import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  AuthPermissionRule,
  AuthRole,
  AuthUser,
  CreateAuthRoleRequest,
  EditableAuthPermissionRule
} from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';
import { PermissionEditorComponent, type PermissionEditorRow } from './permission-editor.component';

@Component({
  selector: 'app-role-permission',
  standalone: true,
  imports: [CommonModule, FormsModule, PermissionEditorComponent],
  templateUrl: './role-permission.component.html',
  styleUrl: './permission-editor.component.scss'
})
export class RolePermissionComponent {
  readonly chill = inject(ChillService);
  readonly users = input<AuthUser[]>([]);
  readonly roles = input<AuthRole[]>([]);
  readonly roleCreated = output<AuthRole>();

  readonly searchTerm = signal('');
  readonly selectedRoleGuid = signal('');
  readonly isLoadingDetails = signal(false);
  readonly isSaving = signal(false);
  readonly isCreatingRole = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly selectedUserGuids = signal<string[]>([]);
  readonly permissionRows = signal<PermissionEditorRow[]>([]);
  readonly originalSnapshot = signal('');
  readonly selectionVersion = signal(0);
  readonly newRole = signal<CreateAuthRoleRequest>({
    name: '',
    description: '',
    isActive: true
  });

  readonly filteredRoles = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    if (!query) {
      return this.roles();
    }

    return this.roles().filter((role) => {
      const haystack = [
        role.name,
        role.description,
        role.guid
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  });

  readonly selectedRole = computed(() =>
    this.roles().find((role) => role.guid === this.selectedRoleGuid()) ?? null
  );

  readonly hasSelection = computed(() => !!this.selectedRole());
  readonly hasChanges = computed(() => {
    if (!this.selectedRole()) {
      return false;
    }

    return this.serializeSnapshot() !== this.originalSnapshot();
  });

  readonly saveDisabled = computed(() =>
    this.isSaving() || this.isLoadingDetails() || !this.selectedRole() || !this.hasChanges()
  );

  constructor() {
    effect(() => {
      const roles = this.roles();
      const selectedRoleGuid = this.selectedRoleGuid();
      if (roles.length === 0) {
        this.selectedRoleGuid.set('');
        this.selectedUserGuids.set([]);
        this.permissionRows.set([]);
        this.originalSnapshot.set('');
        return;
      }

      if (!selectedRoleGuid || !roles.some((role) => role.guid === selectedRoleGuid)) {
        this.selectRole(roles[0].guid);
      }
    });
  }

  selectRole(roleGuid: string): void {
    if (!roleGuid || this.selectedRoleGuid() === roleGuid) {
      return;
    }

    this.selectedRoleGuid.set(roleGuid);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loadSelectedRole(roleGuid);
  }

  updateSearchTerm(value: string): void {
    this.searchTerm.set(value);
  }

  updateNewRoleField<K extends keyof CreateAuthRoleRequest>(key: K, value: CreateAuthRoleRequest[K]): void {
    this.newRole.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  createRole(): void {
    const payload = {
      name: this.newRole().name.trim(),
      description: this.newRole().description.trim(),
      isActive: this.newRole().isActive
    };
    if (!payload.name) {
      this.errorMessage.set(this.chill.T('D1D1A6D7-3898-4E40-93CB-4CBB21697A2D', 'Role name is required.', 'Il nome ruolo e obbligatorio.'));
      this.successMessage.set('');
      return;
    }

    this.isCreatingRole.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.createAuthRole(payload).subscribe({
      next: (role) => {
        this.isCreatingRole.set(false);
        this.newRole.set({
          name: '',
          description: '',
          isActive: true
        });
        this.roleCreated.emit(role);
        this.successMessage.set(this.chill.T('175A80C9-2A43-419F-A835-463E4A0A7BAA', 'Role created.', 'Ruolo creato.'));
        this.selectRole(role.guid);
      },
      error: (error: unknown) => {
        this.isCreatingRole.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  toggleUser(userGuid: string, checked: boolean): void {
    const current = new Set(this.selectedUserGuids());
    if (checked) {
      current.add(userGuid);
    } else {
      current.delete(userGuid);
    }

    this.selectedUserGuids.set([...current]);
  }

  updatePermissionRows(rows: PermissionEditorRow[]): void {
    this.permissionRows.set(rows);
  }

  save(): void {
    const role = this.selectedRole();
    if (!role || this.saveDisabled()) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.saveAuthRoleAccess(
      role.guid,
      this.selectedUserGuids(),
      this.permissionRows().map((row) => this.toPermissionPayload(row))
    ).subscribe({
      next: (response) => {
        this.selectedUserGuids.set(response.users.map((user) => user.guid));
        this.permissionRows.set(response.permissions.map((permission) => this.toPermissionRow(permission)));
        this.originalSnapshot.set(this.serializeSnapshot());
        this.isSaving.set(false);
        this.successMessage.set(this.chill.T('F1F539A5-DB3A-4B32-B68B-9A2084AA0B6E', 'Role permissions updated.', 'Permessi ruolo aggiornati.'));
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

  private loadSelectedRole(roleGuid: string): void {
    this.isLoadingDetails.set(true);
    this.permissionRows.set([]);
    this.selectedUserGuids.set([]);

    this.chill.getAuthRoleAccess(roleGuid).subscribe({
      next: (response) => {
        this.selectionVersion.update((value) => value + 1);
        this.selectedUserGuids.set(response.users.map((user) => user.guid));
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
      userGuids: [...this.selectedUserGuids()].sort(),
      permissions: this.permissionRows().map((row) => this.toPermissionPayload(row))
    });
  }
}
