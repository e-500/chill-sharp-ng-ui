import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import type { AuthRole, AuthUser } from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';
import { WorkspaceToolbarService } from '../../services/workspace-toolbar.service';
import { RolePermissionComponent } from './role-permission.component';
import { UserPermissionComponent } from './user-permission.component';

type PermissionSection = 'users' | 'roles';

@Component({
  selector: 'app-permissions-page',
  standalone: true,
  imports: [CommonModule, UserPermissionComponent, RolePermissionComponent, ChillI18nLabelComponent],
  templateUrl: './permissions-page.component.html',
  styleUrl: './permissions-page.component.scss'
})
export class PermissionsPageComponent implements OnInit, OnDestroy {
  static getComponentConfigurationJsonExample(): Record<string, never> {
    return {};
  }

  readonly chill = inject(ChillService);
  readonly toolbar = inject(WorkspaceToolbarService);

  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly activeSection = signal<PermissionSection>('users');
  readonly users = signal<AuthUser[]>([]);
  readonly roles = signal<AuthRole[]>([]);
  readonly canManagePermissions = signal(false);

  readonly currentUser = computed(() => {
    const session = this.chill.session();
    const normalizedUserName = session?.userName?.trim().toLowerCase() ?? '';
    const normalizedUserId = session?.userId?.trim() ?? '';

    return this.users().find((user) =>
      user.guid === normalizedUserId
      || user.userName.trim().toLowerCase() === normalizedUserName
    ) ?? null;
  });

  constructor() {
    effect(() => {
      if (!this.canManagePermissions()) {
        this.toolbar.clearButtons('workspace');
        return;
      }

      const activeSection = this.activeSection();
      this.toolbar.setButtons([
        {
          id: 'permissions-users',
          labelGuid: '8455C9A5-BAC8-457C-B726-F79DA6D758DF',
          primaryDefaultText: 'Users',
          secondaryDefaultText: 'Utenti',
          ariaLabel: this.chill.T('8455C9A5-BAC8-457C-B726-F79DA6D758DF', 'Users', 'Utenti'),
          action: () => this.setActiveSection('users'),
          disabled: activeSection === 'users'
        },
        {
          id: 'permissions-roles',
          labelGuid: 'B3CC2B2C-8B89-4D4B-B5A0-88CDE26F61A6',
          primaryDefaultText: 'Roles',
          secondaryDefaultText: 'Ruoli',
          ariaLabel: this.chill.T('B3CC2B2C-8B89-4D4B-B5A0-88CDE26F61A6', 'Roles', 'Ruoli'),
          action: () => this.setActiveSection('roles'),
          disabled: activeSection === 'roles'
        }
      ], 'workspace');
    });
  }

  ngOnInit(): void {
    this.loadPage();
  }

  ngOnDestroy(): void {
    this.toolbar.clearButtons('workspace');
  }

  setActiveSection(section: PermissionSection): void {
    this.activeSection.set(section);
  }

  handleUserCreated(user: AuthUser): void {
    this.users.set(this.upsertUser(user));
    this.activeSection.set('users');
  }

  handleUserUpdated(user: AuthUser): void {
    this.users.set(this.upsertUser(user));
  }

  handleRoleCreated(role: AuthRole): void {
    this.roles.set(this.upsertRole(role));
    this.activeSection.set('roles');
  }

  handleRoleUpdated(role: AuthRole): void {
    this.roles.set(this.upsertRole(role));
  }

  private loadPage(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.chill.getAuthUsers().subscribe({
      next: (users) => {
        const sortedUsers = [...users].sort((left, right) => this.userLabel(left).localeCompare(this.userLabel(right)));
        this.users.set(sortedUsers);

        const currentUser = this.resolveCurrentUser(sortedUsers);
        const canManagePermissions = currentUser?.canManagePermissions === true;
        this.canManagePermissions.set(canManagePermissions);

        if (!canManagePermissions) {
          this.roles.set([]);
          this.isLoading.set(false);
          return;
        }

        this.chill.getAuthRoles().subscribe({
          next: (roles) => {
            const sortedRoles = [...roles].sort((left, right) => left.name.localeCompare(right.name));
            this.roles.set(sortedRoles);
            this.isLoading.set(false);
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
        this.canManagePermissions.set(false);
        this.isLoading.set(false);
        this.errorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private resolveCurrentUser(users: AuthUser[]): AuthUser | null {
    const session = this.chill.session();
    const normalizedUserName = session?.userName?.trim().toLowerCase() ?? '';
    const normalizedUserId = session?.userId?.trim() ?? '';

    return users.find((user) =>
      user.guid === normalizedUserId
      || user.userName.trim().toLowerCase() === normalizedUserName
    ) ?? null;
  }

  private userLabel(user: AuthUser): string {
    return user.displayName?.trim() || user.userName?.trim() || user.externalId?.trim() || user.guid;
  }

  private upsertUser(user: AuthUser): AuthUser[] {
    const users = this.users().filter((entry) => entry.guid !== user.guid);
    return [...users, user].sort((left, right) => this.userLabel(left).localeCompare(this.userLabel(right)));
  }

  private upsertRole(role: AuthRole): AuthRole[] {
    const roles = this.roles().filter((entry) => entry.guid !== role.guid);
    return [...roles, role].sort((left, right) => left.name.localeCompare(right.name));
  }
}
