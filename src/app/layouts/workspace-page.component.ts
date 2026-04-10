import { CommonModule, NgComponentOutlet } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, inject, viewChild } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { combineLatest } from 'rxjs';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { WorkspaceService, type WorkspaceTheme } from '../services/workspace.service';
import { WorkspaceToolbarService } from '../services/workspace-toolbar.service';
import { WorkspaceDialogHostComponent } from '../workspace/workspace-dialog-host.component';
import { WorkspaceMenuComponent } from '../workspace/workspace-menu.component';
import { WorkspaceTaskbarComponent } from '../workspace/workspace-taskbar.component';

@Component({
  selector: 'app-workspace-page',
  standalone: true,
  imports: [CommonModule, NgComponentOutlet, WorkspaceTaskbarComponent, WorkspaceMenuComponent, WorkspaceDialogHostComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  template: `
    <section class="workspace-shell">
      <header class="workspace-topbar">
        <div class="workspace-topbar__left">
          <button
            type="button"
            class="icon-button"
            (click)="workspace.toggleDrawer()"
            [attr.aria-expanded]="workspace.isDrawerOpen()"
            [attr.aria-label]="chill.T('D3C89A1B-4D98-4264-A836-785998F8F09F', 'Open navigation menu', 'Apri menu di navigazione')">
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        <app-workspace-taskbar class="workspace-topbar__center" />

        <div class="workspace-topbar__right">
          @if (toolbar.buttons().length > 0) {
            <div class="workspace-toolbar-actions">
              @for (button of toolbar.buttons(); track button.id) {
                <button
                  type="button"
                  class="workspace-toolbar-button"
                  (click)="button.action()"
                  [disabled]="button.disabled"
                  [attr.aria-label]="button.ariaLabel || button.label || button.primaryDefaultText">
                  @if (button.icon) {
                    <span
                      class="workspace-toolbar-button__icon"
                      [class.material-symbol-icon]="button.iconClass === 'material-symbol-icon'"
                      aria-hidden="true">{{ button.icon }}</span>
                  }
                  @if (button.labelGuid && button.primaryDefaultText && button.secondaryDefaultText) {
                    <app-chill-i18n-button-label
                      [labelGuid]="button.labelGuid"
                      [primaryDefaultText]="button.primaryDefaultText"
                      [secondaryDefaultText]="button.secondaryDefaultText" />
                  } @else {
                    <span>{{ button.label }}</span>
                  }
                </button>
              }
            </div>
          }

          <details class="theme-menu" #themeMenu>
            <summary
              class="theme-menu__summary"
              [attr.aria-label]="chill.T('C698F19E-58EA-41E2-8D31-05137F17C292', 'Theme selection', 'Selezione tema')">
              <span class="theme-menu__swatch" [attr.data-theme]="workspace.theme()"></span>
              <span class="theme-menu__label">{{ workspace.theme() }}</span>
            </summary>

            <div class="theme-menu__panel">
              @for (theme of themes; track theme) {
                <button
                  type="button"
                  class="theme-pill"
                  [class.active]="workspace.theme() === theme"
                  (click)="setTheme(theme)">
                  {{ theme }}
                </button>
              }
            </div>
          </details>

          <details class="user-menu" #userMenu>
            <summary>
              <span class="user-avatar">{{ userInitial() }}</span>
            </summary>

            <div class="user-menu__panel">
              <p class="user-menu__name">{{ chill.userName() || chill.T('B0311DA4-F864-4E15-93A4-894D177F7017', 'current user', 'utente corrente') }}</p>
              <button type="button" (click)="openPermissionsTask()">
                <app-chill-i18n-button-label [labelGuid]="'830A6D96-0332-4B08-8EC7-B850702B4337'" [primaryDefaultText]="'Permissions'" [secondaryDefaultText]="'Permessi'" />
              </button>
              <button type="button" (click)="workspace.toggleLayoutEditingEnabled()">
                @if (workspace.isLayoutEditingEnabled()) {
                  <app-chill-i18n-button-label [labelGuid]="'84A896C2-2A1F-4DCE-8B33-A0F586F1DBE8'" [primaryDefaultText]="'Disable layout editing'" [secondaryDefaultText]="'Disabilita modifica layout'" />
                } @else {
                  <app-chill-i18n-button-label [labelGuid]="'A94DDDE0-3CDB-495A-84D7-8226AB21D6C7'" [primaryDefaultText]="'Enable layout editing'" [secondaryDefaultText]="'Abilita modifica layout'" />
                }
              </button>
              <button type="button" (click)="goToChangePassword()">
                <app-chill-i18n-button-label [labelGuid]="'56083997-E7B4-4AE0-B7C6-DB2B82186232'" [primaryDefaultText]="'Change password'" [secondaryDefaultText]="'Cambia password'" />
              </button>
              <button type="button" (click)="logout()">
                <app-chill-i18n-button-label [labelGuid]="'9177351F-738D-447C-8A75-06536CA6E50C'" [primaryDefaultText]="'Logout'" [secondaryDefaultText]="'Disconnetti'" />
              </button>
            </div>
          </details>
        </div>
      </header>

      <div class="workspace-main">
        <aside class="workspace-drawer" [class.open]="workspace.isDrawerOpen()">
          <app-workspace-menu />
        </aside>

        <main class="workspace-content">
          @if (workspace.activeTask(); as task) {
            <div class="workspace-task-host">
              @for (activeTask of [task]; track activeTask.id) {
                <ng-container *ngComponentOutlet="activeTask.component; inputs: activeTask.inputs ?? {}" />
              }
            </div>
          } @else {
            <section class="workspace-empty-state">
              <p class="eyebrow">
                <app-chill-i18n-label
                  [labelGuid]="'F339653B-60A0-4589-B6EA-3BD8220D17EE'"
                  [primaryDefaultText]="'Cini Home'"
                  [secondaryDefaultText]="'Cini Home'" />
              </p>
              <h2>
                <app-chill-i18n-label
                  [labelGuid]="'D1B457BA-B716-4C96-BF66-4B20E1ACD805'"
                  [primaryDefaultText]="'No active task'"
                  [secondaryDefaultText]="'Nessuna attivita attiva'" />
              </h2>
              <p>
                <app-chill-i18n-label
                  [labelGuid]="'3C4B25A7-6208-4C74-8515-47A2E6E8655A'"
                  [primaryDefaultText]="'Open a task from the drawer to start working inside the workspace.'"
                  [secondaryDefaultText]="'Apri una attivita dal drawer per iniziare a lavorare nel workspace.'" />
              </p>
            </section>
          }
        </main>
      </div>

      @if (dialog.activeDialog()) {
        <app-workspace-dialog-host />
      }
    </section>
  `
})
export class WorkspacePageComponent implements OnInit {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly toolbar = inject(WorkspaceToolbarService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly themeMenu = viewChild<ElementRef<HTMLDetailsElement>>('themeMenu');
  private readonly userMenu = viewChild<ElementRef<HTMLDetailsElement>>('userMenu');

  readonly themes: WorkspaceTheme[] = ['bright', 'dark', 'soft'];

  ngOnInit(): void {
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([paramMap, queryParamMap]: [ParamMap, ParamMap]) => {
      void this.workspace.activateTaskFromRoute(paramMap.get('taskId'), queryParamMap);
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    this.workspace.toggleLayoutEditingEnabled();
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const themeMenu = this.themeMenu()?.nativeElement;
    if (themeMenu?.open && !themeMenu.contains(target)) {
      themeMenu.open = false;
    }

    const userMenu = this.userMenu()?.nativeElement;
    if (userMenu?.open && !userMenu.contains(target)) {
      userMenu.open = false;
    }
  }

  userInitial(): string {
    const userName = this.chill.userName().trim();
    return userName ? userName[0].toUpperCase() : 'U';
  }

  setTheme(theme: WorkspaceTheme): void {
    this.workspace.setTheme(theme);
    const themeMenu = this.themeMenu()?.nativeElement;
    if (themeMenu) {
      themeMenu.open = false;
    }
  }

  openPermissionsTask(): void {
    this.closeUserMenu();
    void this.workspace.openTask('permissions');
  }

  goToChangePassword(): void {
    this.closeUserMenu();
    this.workspace.closeDrawer();
    void this.router.navigateByUrl('/reset-password');
  }

  logout(): void {
    this.closeUserMenu();
    this.chill.logout();
    this.workspace.reset();
    void this.router.navigateByUrl('/login');
  }

  private closeUserMenu(): void {
    const userMenu = this.userMenu()?.nativeElement;
    if (userMenu) {
      userMenu.open = false;
    }
  }
}
