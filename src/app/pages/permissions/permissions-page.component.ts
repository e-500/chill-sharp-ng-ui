import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ChillI18nButtonLabelComponent } from '../../lib/chill-i18n-button-label.component';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import type { AuthRole, AuthUser } from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';
import { RolePermissionComponent } from './role-permission.component';
import { UserPermissionComponent } from './user-permission.component';

type PermissionTab = 'user' | 'role';

@Component({
  selector: 'app-permissions-page',
  standalone: true,
  imports: [CommonModule, UserPermissionComponent, RolePermissionComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  templateUrl: './permissions-page.component.html',
  styleUrl: './permissions-page.component.scss'
})
export class PermissionsPageComponent implements OnInit {
  readonly chill = inject(ChillService);

  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly activeTab = signal<PermissionTab>('user');
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

  ngOnInit(): void {
    this.loadPage();
  }

  setActiveTab(tab: PermissionTab): void {
    this.activeTab.set(tab);
  }

  handleRoleCreated(role: AuthRole): void {
    const roles = [...this.roles(), role].sort((left, right) => left.name.localeCompare(right.name));
    this.roles.set(roles);
    this.activeTab.set('role');
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
}
