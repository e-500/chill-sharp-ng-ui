import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../../lib/chill-i18n-button-label.component';
import type {
  AuthPermissionRule,
  AuthRole,
  AuthUser,
  EditableAuthPermissionRule
} from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { AuthSearchSelectComponent, type AuthSearchSelectOption } from './auth-search-select.component';
import { PermissionEditorComponent, type PermissionEditorRow } from './permission-editor.component';

@Component({
  selector: 'app-role-permission',
  standalone: true,
  imports: [CommonModule, PermissionEditorComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent, AuthSearchSelectComponent],
  templateUrl: './role-permission.component.html',
  styleUrl: './permission-editor.component.scss'
})
export class RolePermissionComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);
  readonly users = input<AuthUser[]>([]);
  readonly roles = input<AuthRole[]>([]);
  readonly roleCreated = output<AuthRole>();
  readonly roleUpdated = output<AuthRole>();

  readonly selectedRoleGuid = signal('');
  readonly isLoadingDetails = signal(false);
  readonly isSaving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly selectedUserGuids = signal<string[]>([]);
  readonly permissionRows = signal<PermissionEditorRow[]>([]);
  readonly originalSnapshot = signal('');
  readonly selectionVersion = signal(0);

  readonly roleOptions = computed<AuthSearchSelectOption[]>(() =>
    this.roles().map((role) => ({
      id: role.guid,
      label: role.name,
      description: role.description,
      keywords: [role.name, role.description, role.guid].join(' ')
    }))
  );

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
        this.clearSelectionState();
        return;
      }

      if (selectedRoleGuid && !roles.some((role) => role.guid === selectedRoleGuid)) {
        this.clearSelectionState();
      }
    });
  }

  selectRole(roleGuid: string): void {
    if (!roleGuid) {
      this.clearSelectionState();
      return;
    }

    if (this.selectedRoleGuid() === roleGuid) {
      return;
    }

    this.selectedRoleGuid.set(roleGuid);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.loadSelectedRole(roleGuid);
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

  async openCreateRoleDialog(): Promise<void> {
    const { AuthRoleDialogComponent } = await import('./auth-role-dialog.component');
    const result = await this.dialog.openDialog<AuthRole>({
      title: this.chill.T('0B47EAA4-33BC-4D1C-B8C6-F75D3A5C8864', 'Create role', 'Crea ruolo'),
      component: AuthRoleDialogComponent,
      okLabel: await this.chill.TAsync('61E5DBBB-413A-449B-BE0E-B4A991FA1E39', 'Create', 'Crea')
    });

    if (result.status !== 'confirmed' || !result.value) {
      return;
    }

    this.roleCreated.emit(result.value);
    this.selectRole(result.value.guid);
    this.successMessage.set(this.chill.T('175A80C9-2A43-419F-A835-463E4A0A7BAA', 'Role created.', 'Ruolo creato.'));
  }

  async openEditRoleDialog(): Promise<void> {
    const role = this.selectedRole();
    if (!role) {
      return;
    }

    const { AuthRoleDialogComponent } = await import('./auth-role-dialog.component');
    const result = await this.dialog.openDialog<AuthRole>({
      title: this.chill.T('49DE3A27-3C6C-4E9F-9F07-6B1FAE3DC3E4', 'Edit role', 'Modifica ruolo'),
      component: AuthRoleDialogComponent,
      okLabel: await this.chill.TAsync('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Save', 'Salva'),
      inputs: {
        roleGuid: role.guid
      }
    });

    if (result.status !== 'confirmed' || !result.value) {
      return;
    }

    this.roleUpdated.emit(result.value);
    this.selectRole(result.value.guid);
    this.successMessage.set(this.chill.T('4D95B0C0-73A2-4B35-9D06-A4F9133B768E', 'Role details updated.', 'Dettagli ruolo aggiornati.'));
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

  private clearSelectionState(): void {
    this.selectedRoleGuid.set('');
    this.selectedUserGuids.set([]);
    this.permissionRows.set([]);
    this.originalSnapshot.set('');
    this.isLoadingDetails.set(false);
  }
}
