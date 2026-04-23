import { CommonModule, NgComponentOutlet } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, viewChild, viewChildren } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { combineLatest, firstValueFrom } from 'rxjs';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillI18nLabelComponent } from '../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { WorkspaceService, type WorkspaceTheme } from '../services/workspace.service';
import { WorkspaceToolbarService } from '../services/workspace-toolbar.service';
import { WorkspaceDialogHostComponent } from '../workspace/workspace-dialog-host.component';
import { WorkspaceMenuComponent } from '../workspace/workspace-menu.component';
import { WorkspaceTaskbarComponent } from '../workspace/workspace-taskbar.component';
import type { WorkspaceTaskComponent, WorkspaceTaskComponentType } from '../models/workspace-task.models';
import type { WorkspaceTaskInstance } from '../services/workspace.service';

@Component({
  selector: 'app-workspace-page',
  standalone: true,
  imports: [CommonModule, NgComponentOutlet, WorkspaceTaskbarComponent, WorkspaceMenuComponent, WorkspaceDialogHostComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  styles: `
    .workspace-topbar {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
      align-items: center;
      gap: 0.75rem;
    }

    .workspace-topbar__left {
      grid-column: 1;
    }

    .workspace-topbar__center {
      grid-column: 2;
      min-width: 0;
    }

    .workspace-topbar__controls {
      grid-column: 4;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .workspace-toolbar-actions {
      grid-column: 3;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.65rem;
      min-width: 0;
    }

    .workspace-task-host,
    .workspace-task-pane {
      display: block;
      height: 100%;
      min-height: 0;
    }

    .workspace-task-pane[hidden] {
      display: none !important;
    }

    .workspace-toolbar-button--accent {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      color: #f8fffd;
    }

    .workspace-toolbar-button--accent .workspace-toolbar-button__text,
    .workspace-toolbar-button--accent .workspace-toolbar-button__icon {
      color: #f8fffd;
    }

    .workspace-toolbar-button--accent:disabled {
      border-color: var(--border-color);
      background: var(--surface-0);
      color: var(--text-main);
    }

    .workspace-toolbar-button__text {
      display: inline-flex;
      align-items: center;
    }

    @media (max-width: 720px) {
      .workspace-topbar {
        grid-template-columns: auto minmax(0, 1fr) auto;
        row-gap: 0.6rem;
      }

      .workspace-topbar__left {
        grid-column: 1;
        grid-row: 1;
      }

      .workspace-topbar__center {
        grid-column: 2;
        grid-row: 1;
        width: 100%;
      }

      .workspace-topbar__controls {
        grid-column: 3;
        grid-row: 1;
      }

      .workspace-toolbar-actions {
        grid-column: 1 / -1;
        grid-row: 2;
        justify-content: flex-start;
      }

      .workspace-toolbar-button--has-icon {
        min-width: 2.75rem;
        justify-content: center;
        padding-inline: 0.75rem;
      }

      .workspace-toolbar-button--has-icon .workspace-toolbar-button__text {
        display: none;
      }

      .theme-menu__label {
        display: none;
      }
    }
  `,
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

        @if (activeToolbarButtons().length > 0) {
          <div class="workspace-toolbar-actions">
            @for (button of activeToolbarButtons(); track button.id) {
              <button
                type="button"
                class="workspace-toolbar-button"
                [class.workspace-toolbar-button--accent]="button.accent"
                [class.workspace-toolbar-button--has-icon]="!!button.icon"
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
                  <span class="workspace-toolbar-button__text">
                    <app-chill-i18n-button-label
                      [labelGuid]="button.labelGuid"
                      [primaryDefaultText]="button.primaryDefaultText"
                      [secondaryDefaultText]="button.secondaryDefaultText" />
                  </span>
                } @else {
                  <span class="workspace-toolbar-button__text">{{ button.label }}</span>
                }
              </button>
            }
          </div>
        }

        <div class="workspace-topbar__controls">
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
              <button
                type="button"
                (click)="copyAuthToken()"
                [disabled]="!chill.session()?.accessToken"
                [attr.aria-label]="authTokenCopyLabel()">
                {{ authTokenCopyLabel() }}
              </button>
              <button
                type="button"
                (click)="renewAuthToken()"
                [disabled]="isRenewingToken() || !chill.session()?.refreshToken">
                @if (isRenewingToken()) {
                  {{ chill.T('3606439C-1C2C-45D4-BAC9-2F0C2AB1E783', 'Renewing token...', 'Rinnovo token...') }}
                } @else {
                  {{ chill.T('B9C91C98-E52E-49DA-A3BC-6593F38BB93D', 'Renew token', 'Rinnova token') }}
                }
              </button>
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
          @if (workspace.openTasks().length > 0) {
            <div class="workspace-task-host">
              @for (task of workspace.openTasks(); track task.id) {
                <div class="workspace-task-pane" [hidden]="!isTaskVisible(task.id)">
                  <ng-container *ngComponentOutlet="task.component; inputs: taskInputs(task)" />
                </div>
              }
            </div>
          } @else {
            <section class="workspace-empty-state">
              <p class="eyebrow">
                <app-chill-i18n-label
                  [labelGuid]="'D8E9F1A4-3E8A-47A7-BE9C-1C702F81C6B0'"
                  [primaryDefaultText]="'ChillSharp UI'"
                  [secondaryDefaultText]="'ChillSharp UI'" />
              </p>
              <h2>
                <app-chill-i18n-label
                  [labelGuid]="'6E9CFCD5-61BD-42DA-9666-1570CAEF87D7'"
                  [primaryDefaultText]="'No active task'"
                  [secondaryDefaultText]="'Nessuna attivita'" />
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
export class WorkspacePageComponent implements OnInit, OnDestroy {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly toolbar = inject(WorkspaceToolbarService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly themeMenu = viewChild<ElementRef<HTMLDetailsElement>>('themeMenu');
  private readonly userMenu = viewChild<ElementRef<HTMLDetailsElement>>('userMenu');
  private readonly taskOutlets = viewChildren(NgComponentOutlet);
  private tokenClockHandle: ReturnType<typeof globalThis.setInterval> | null = null;

  readonly themes: WorkspaceTheme[] = ['bright', 'dark', 'soft', 'cini'];
  readonly nowMs = signal(Date.now());
  readonly isRenewingToken = signal(false);
  readonly activeToolbarButtons = computed(() =>
    this.toolbar.buttons(this.workspace.activeTask()?.toolbarScope ?? 'workspace')
  );
  readonly authTokenCopyLabel = computed(() => {
    this.nowMs();
    const hoursLabel = this.authTokenRemainingHoursLabel();
    const baseText = this.chill.T('59083B57-F07E-4F5F-AF93-1B67F2A717B5', 'Copy auth token', 'Copia token auth');
    return hoursLabel ? `${baseText} (${hoursLabel})` : baseText;
  });

  ngOnInit(): void {
    this.tokenClockHandle = globalThis.setInterval(() => {
      this.nowMs.set(Date.now());
    }, 60000);

    this.workspace.registerTaskComponentResolver((taskId) => this.resolveTaskComponent(taskId));
    combineLatest([this.route.paramMap, this.route.queryParamMap]).subscribe(([paramMap, queryParamMap]: [ParamMap, ParamMap]) => {
      void this.workspace.activateTaskFromRoute(paramMap.get('taskId'), queryParamMap);
    });
  }

  ngOnDestroy(): void {
    if (this.tokenClockHandle) {
      globalThis.clearInterval(this.tokenClockHandle);
      this.tokenClockHandle = null;
    }
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

  @HostListener('window:beforeunload', ['$event'])
  handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.workspace.canUnloadWorkspace()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
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

  async copyAuthToken(): Promise<void> {
    const token = this.chill.session()?.accessToken ?? '';
    if (!token) {
      return;
    }

    await this.writeClipboardText(token);
  }

  async renewAuthToken(): Promise<void> {
    if (this.isRenewingToken() || !this.chill.session()?.refreshToken) {
      return;
    }

    this.isRenewingToken.set(true);
    try {
      await firstValueFrom(this.chill.refreshSession());
      this.nowMs.set(Date.now());
    } finally {
      this.isRenewingToken.set(false);
    }
  }

  goToChangePassword(): void {
    this.closeUserMenu();
    this.workspace.closeDrawer();
    void this.navigateAway('/reset-password');
  }

  logout(): void {
    this.closeUserMenu();
    this.chill.logout();
    void this.logoutAndReset();
  }

  private closeUserMenu(): void {
    const userMenu = this.userMenu()?.nativeElement;
    if (userMenu) {
      userMenu.open = false;
    }
  }

  private authTokenRemainingHoursLabel(): string {
    const expiresUtc = this.chill.session()?.accessTokenExpiresUtc?.trim() ?? '';
    if (!expiresUtc) {
      return '';
    }

    const expiresMs = Date.parse(expiresUtc);
    if (!Number.isFinite(expiresMs)) {
      return '';
    }

    const remainingMs = expiresMs - this.nowMs();
    if (remainingMs <= 0) {
      return this.chill.T('8B5933DD-3500-4EEC-B28E-038CA7C2DF3D', 'expired', 'scaduto');
    }

    const remainingHours = remainingMs / 3_600_000;
    const formattedHours = remainingHours >= 10
      ? Math.floor(remainingHours).toString()
      : Math.max(0.1, Math.floor(remainingHours * 10) / 10).toLocaleString(undefined, {
          maximumFractionDigits: 1
        });
    return this.chill.T('53A9DE67-EDAF-4B43-AC07-EEC3F6F5F98F', `${formattedHours} h left`, `${formattedHours} h rimanenti`);
  }

  private async writeClipboardText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  isTaskVisible(taskId: string): boolean {
    return this.workspace.activeTask()?.id === taskId;
  }

  taskInputs(task: WorkspaceTaskInstance): Record<string, unknown> {
    const inputs = { ...(task.inputs ?? {}) };
    if (this.supportsInput(task.component, 'visible')) {
      inputs['visible'] = this.isTaskVisible(task.id);
    }

    if (this.supportsInput(task.component, 'toolbarScope')) {
      inputs['toolbarScope'] = task.toolbarScope;
    }

    return inputs;
  }

  private supportsInput(component: WorkspaceTaskComponentType, inputName: string): boolean {
    const definition = (component as WorkspaceTaskComponentType & {
      ɵcmp?: { inputs?: Record<string, string> };
    }).ɵcmp;

    if (!definition?.inputs) {
      return false;
    }

    return Object.prototype.hasOwnProperty.call(definition.inputs, inputName);
  }

  private resolveTaskComponent(taskId: string): WorkspaceTaskComponent | null {
    const taskIndex = this.workspace.openTasks().findIndex((task) => task.id === taskId);
    if (taskIndex < 0) {
      return null;
    }

    const outlet = this.taskOutlets()[taskIndex];
    const componentInstance = (outlet as NgComponentOutlet & { componentInstance?: unknown }).componentInstance;
    return this.isWorkspaceTaskComponent(componentInstance)
      ? componentInstance
      : null;
  }

  private isWorkspaceTaskComponent(value: unknown): value is WorkspaceTaskComponent {
    return !!value && typeof value === 'object';
  }

  private async navigateAway(url: string): Promise<void> {
    const reset = await this.workspace.reset();
    if (!reset) {
      return;
    }

    void this.router.navigateByUrl(url);
  }

  private async logoutAndReset(): Promise<void> {
    const reset = await this.workspace.reset();
    if (!reset) {
      return;
    }

    this.chill.logout();
    void this.router.navigateByUrl('/login');
  }
}
