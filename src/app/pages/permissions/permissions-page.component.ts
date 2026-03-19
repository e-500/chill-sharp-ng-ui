import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import {
  PermissionAction,
  PermissionEffect,
  PermissionScope,
  type AuthPermissionRule,
  type AuthRole,
  type AuthUser,
  type CreateAuthPermissionRuleRequest,
  type CreateAuthRoleRequest,
  type UpdateAuthUserRequest
} from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';

type PermissionSubjectType = 'user' | 'role';

@Component({
  selector: 'app-permissions-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './permissions-page.component.html',
  styleUrl: './permissions-page.component.scss'
})
export class PermissionsPageComponent implements OnInit {
  readonly chill = inject(ChillService);

  readonly isLoading = signal(true);
  readonly isSavingUser = signal(false);
  readonly isCreatingRole = signal(false);
  readonly isCreatingRule = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly users = signal<AuthUser[]>([]);
  readonly roles = signal<AuthRole[]>([]);
  readonly userRoleIds = signal<string[]>([]);
  readonly permissionRules = signal<AuthPermissionRule[]>([]);

  readonly selectedUserGuid = signal('');
  readonly selectedRoleGuid = signal('');
  readonly permissionSubjectType = signal<PermissionSubjectType>('user');

  readonly userForm = signal<UpdateAuthUserRequest>({
    externalId: '',
    userName: '',
    displayName: '',
    isActive: true,
    canManagePermissions: false
  });

  readonly newRole = signal<CreateAuthRoleRequest>({
    name: '',
    description: '',
    isActive: true
  });

  readonly newRule = signal<CreateAuthPermissionRuleRequest>({
    userGuid: '',
    roleGuid: '',
    effect: PermissionEffect.Allow,
    action: PermissionAction.Query,
    scope: PermissionScope.Module,
    module: '',
    entityName: '',
    propertyName: '',
    appliesToAllProperties: false,
    description: ''
  });

  readonly selectedUser = computed(() =>
    this.users().find((user) => user.guid === this.selectedUserGuid()) ?? null
  );

  readonly selectedRole = computed(() =>
    this.roles().find((role) => role.guid === this.selectedRoleGuid()) ?? null
  );

  readonly permissionTargetGuid = computed(() =>
    this.permissionSubjectType() === 'user' ? this.selectedUserGuid() : this.selectedRoleGuid()
  );

  readonly permissionEffectOptions = [
    { value: PermissionEffect.Allow, label: 'Allow' },
    { value: PermissionEffect.Deny, label: 'Deny' }
  ];

  readonly permissionActionOptions = [
    { value: PermissionAction.Query, label: 'Query' },
    { value: PermissionAction.Create, label: 'Create' },
    { value: PermissionAction.Update, label: 'Update' },
    { value: PermissionAction.Delete, label: 'Delete' },
    { value: PermissionAction.See, label: 'See' },
    { value: PermissionAction.Modify, label: 'Modify' }
  ];

  readonly permissionScopeOptions = [
    { value: PermissionScope.Module, label: 'Module' },
    { value: PermissionScope.Entity, label: 'Entity' },
    { value: PermissionScope.Property, label: 'Property' }
  ];

  ngOnInit(): void {
    this.loadPage();
  }

  selectUser(userGuid: string): void {
    this.selectedUserGuid.set(userGuid);
    const user = this.users().find((entry) => entry.guid === userGuid);
    if (!user) {
      return;
    }

    this.userForm.set({
      externalId: user.externalId,
      userName: user.userName,
      displayName: user.displayName,
      isActive: user.isActive,
      canManagePermissions: user.canManagePermissions
    });

    this.successMessage.set('');
    this.errorMessage.set('');

    this.chill.getAuthUserRoles(userGuid).subscribe({
      next: (roles) => {
        this.userRoleIds.set(roles.map((role) => role.guid));
      },
      error: (error: unknown) => {
        this.userRoleIds.set([]);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });

    if (this.permissionSubjectType() === 'user') {
      this.loadPermissionRules();
    }
  }

  selectRole(roleGuid: string): void {
    this.selectedRoleGuid.set(roleGuid);
    this.successMessage.set('');
    this.errorMessage.set('');

    if (this.permissionSubjectType() === 'role') {
      this.loadPermissionRules();
    }
  }

  setPermissionSubjectType(subjectType: PermissionSubjectType): void {
    this.permissionSubjectType.set(subjectType);
    this.successMessage.set('');
    this.errorMessage.set('');
    this.loadPermissionRules();
  }

  updateUserField<K extends keyof UpdateAuthUserRequest>(key: K, value: UpdateAuthUserRequest[K]): void {
    this.userForm.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  updateNewRoleField<K extends keyof CreateAuthRoleRequest>(key: K, value: CreateAuthRoleRequest[K]): void {
    this.newRole.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  updateNewRuleField<K extends keyof CreateAuthPermissionRuleRequest>(key: K, value: CreateAuthPermissionRuleRequest[K]): void {
    this.newRule.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  toggleUserRole(roleGuid: string, checked: boolean): void {
    const current = new Set(this.userRoleIds());
    if (checked) {
      current.add(roleGuid);
    } else {
      current.delete(roleGuid);
    }

    this.userRoleIds.set([...current]);
  }

  saveUser(): void {
    const userGuid = this.selectedUserGuid();
    if (!userGuid) {
      return;
    }

    this.isSavingUser.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.updateAuthUser(userGuid, this.userForm()).subscribe({
      next: (updatedUser) => {
        this.users.update((users) => users.map((user) => user.guid === userGuid ? updatedUser : user));
        void this.syncUserRoles(userGuid);
      },
      error: (error: unknown) => {
        this.isSavingUser.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  createRole(): void {
    const payload = this.newRole();
    if (!payload.name.trim()) {
      this.errorMessage.set(this.chill.T('D1D1A6D7-3898-4E40-93CB-4CBB21697A2D', 'Role name is required.', 'Il nome ruolo è obbligatorio.'));
      return;
    }

    this.isCreatingRole.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.createAuthRole(payload).subscribe({
      next: (role) => {
        this.roles.update((roles) => [...roles, role].sort((left, right) => left.name.localeCompare(right.name)));
        this.selectedRoleGuid.set(role.guid);
        this.newRole.set({
          name: '',
          description: '',
          isActive: true
        });
        this.isCreatingRole.set(false);
        this.successMessage.set(this.chill.T('175A80C9-2A43-419F-A835-463E4A0A7BAA', 'Role created.', 'Ruolo creato.'));
        if (this.permissionSubjectType() === 'role') {
          this.loadPermissionRules();
        }
      },
      error: (error: unknown) => {
        this.isCreatingRole.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  createPermissionRule(): void {
    const subjectType = this.permissionSubjectType();
    const subjectGuid = this.permissionTargetGuid();
    if (!subjectGuid) {
      this.errorMessage.set(this.chill.T('33046F4E-6C29-47DA-A00E-0B95BA13C43E', 'Select a target before creating a permission rule.', 'Seleziona una destinazione prima di creare una regola permesso.'));
      return;
    }

    const payload = this.newRule();
    if (!payload.module.trim()) {
      this.errorMessage.set(this.chill.T('DFA9726D-3F4E-47DA-B567-0F7103D2601D', 'Module is required.', 'Il modulo è obbligatorio.'));
      return;
    }

    const request: CreateAuthPermissionRuleRequest = {
      ...payload,
      userGuid: subjectType === 'user' ? subjectGuid : '',
      roleGuid: subjectType === 'role' ? subjectGuid : ''
    };

    this.isCreatingRule.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.createAuthPermissionRule(request).subscribe({
      next: () => {
        this.isCreatingRule.set(false);
        this.resetNewRule(subjectType, subjectGuid);
        this.successMessage.set(this.chill.T('F6EEDB5A-1696-4FC6-A9A6-4FB0325A0716', 'Permission rule created.', 'Regola permesso creata.'));
        this.loadPermissionRules();
      },
      error: (error: unknown) => {
        this.isCreatingRule.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  deletePermissionRule(ruleGuid: string): void {
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.deleteAuthPermissionRule(ruleGuid).subscribe({
      next: () => {
        this.permissionRules.update((rules) => rules.filter((rule) => rule.guid !== ruleGuid));
        this.successMessage.set(this.chill.T('397E0E0F-F6EB-45FA-B7D3-8D81EFAD2D0E', 'Permission rule removed.', 'Regola permesso rimossa.'));
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  effectLabel(effect: PermissionEffect): string {
    return this.permissionEffectOptions.find((item) => item.value === effect)?.label ?? `${effect}`;
  }

  actionLabel(action: PermissionAction): string {
    return this.permissionActionOptions.find((item) => item.value === action)?.label ?? `${action}`;
  }

  scopeLabel(scope: PermissionScope): string {
    return this.permissionScopeOptions.find((item) => item.value === scope)?.label ?? `${scope}`;
  }

  userLabel(user: AuthUser): string {
    return user.displayName?.trim() || user.userName?.trim() || user.externalId?.trim() || user.guid;
  }

  private loadPage(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    this.chill.getAuthUsers().subscribe({
      next: (users) => {
        const sortedUsers = [...users].sort((left, right) => this.userLabel(left).localeCompare(this.userLabel(right)));
        this.users.set(sortedUsers);
        this.chill.getAuthRoles().subscribe({
          next: (roles) => {
            const sortedRoles = [...roles].sort((left, right) => left.name.localeCompare(right.name));
            this.roles.set(sortedRoles);
            this.isLoading.set(false);

            if (sortedUsers.length > 0) {
              this.selectUser(sortedUsers[0].guid);
            }
            if (sortedRoles.length > 0) {
              this.selectRole(sortedRoles[0].guid);
            }
          },
          error: (error: unknown) => {
            this.roles.set([]);
            this.isLoading.set(false);
            this.errorMessage.set(this.chill.formatError(error));
          }
        });
      },
      error: (error: unknown) => {
        this.users.set([]);
        this.roles.set([]);
        this.isLoading.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private async syncUserRoles(userGuid: string): Promise<void> {
    try {
      const currentRoles = await firstValueFrom(this.chill.getAuthUserRoles(userGuid));
      const currentIds = new Set(currentRoles.map((role) => role.guid));
      const targetIds = new Set(this.userRoleIds());
      const additions = [...targetIds].filter((roleGuid) => !currentIds.has(roleGuid));
      const removals = [...currentIds].filter((roleGuid) => !targetIds.has(roleGuid));

      for (const roleGuid of additions) {
        await firstValueFrom(this.chill.assignAuthRole(userGuid, roleGuid));
      }

      for (const roleGuid of removals) {
        await firstValueFrom(this.chill.removeAuthRole(userGuid, roleGuid));
      }

      this.isSavingUser.set(false);
      this.successMessage.set(this.chill.T('7F2F0CE1-88D9-4EF7-B7EA-2A729986AB27', 'User permissions updated.', 'Permessi utente aggiornati.'));
    } catch (error) {
      this.isSavingUser.set(false);
      this.errorMessage.set(this.chill.formatError(error));
    }
  }

  private loadPermissionRules(): void {
    const subjectType = this.permissionSubjectType();
    const subjectGuid = this.permissionTargetGuid();
    if (!subjectGuid) {
      this.permissionRules.set([]);
      return;
    }

    this.resetNewRule(subjectType, subjectGuid);

    this.chill.getAuthPermissionRules(
      subjectType === 'user' ? subjectGuid : undefined,
      subjectType === 'role' ? subjectGuid : undefined
    ).subscribe({
      next: (rules) => {
        this.permissionRules.set(rules);
      },
      error: (error: unknown) => {
        this.permissionRules.set([]);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private resetNewRule(subjectType: PermissionSubjectType, subjectGuid: string): void {
    this.newRule.set({
      userGuid: subjectType === 'user' ? subjectGuid : '',
      roleGuid: subjectType === 'role' ? subjectGuid : '',
      effect: PermissionEffect.Allow,
      action: PermissionAction.Query,
      scope: PermissionScope.Module,
      module: '',
      entityName: '',
      propertyName: '',
      appliesToAllProperties: false,
      description: ''
    });
  }
}
