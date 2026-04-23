import { CommonModule } from '@angular/common';
import {
  Component,
  ComponentRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  signal,
  viewChildren
} from '@angular/core';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import type { WorkspaceTaskComponent } from '../models/workspace-task.models';
import { ChillI18nButtonLabelComponent } from '../lib/chill-i18n-button-label.component';
import { WorkspaceToolbarService } from '../services/workspace-toolbar.service';

interface DialogSubmitComponent {
  submit(): void | Promise<void>;
  canDialogSubmit?(): boolean;
}

@Component({
  selector: 'app-workspace-dialog-host',
  standalone: true,
  imports: [CommonModule, ChillI18nButtonLabelComponent],
  template: `
    @if (dialog.dialogs().length > 0) {
      @for (activeDialog of dialog.dialogs(); track activeDialog.id) {
        @if (isTopDialog(activeDialog.id)) {
          <div class="workspace-dialog-backdrop" (click)="cancel(activeDialog.id)"></div>
        }

        <section
          class="workspace-dialog"
          [class.is-background]="!isTopDialog(activeDialog.id)"
          role="dialog"
          [attr.aria-modal]="isTopDialog(activeDialog.id) ? 'true' : null"
          [attr.aria-hidden]="isTopDialog(activeDialog.id) ? null : 'true'"
          [attr.aria-label]="activeDialog.title">
        <header class="workspace-dialog__toolbar">
          <div class="workspace-dialog__title">
            <p>{{ chill.T('4ED0A2E7-CFF1-4593-8861-18B9EBF9F10A', 'Task dialog', 'Dialog attivita') }}</p>
            <h2>{{ activeDialog.title }}</h2>
          </div>

          @if (isTopDialog(activeDialog.id) && toolbarButtons().length > 0) {
            <div class="workspace-dialog__toolbar-actions">
              @for (button of toolbarButtons(); track button.id) {
                <button
                  type="button"
                  class="workspace-dialog__toolbar-button"
                  (click)="button.action()"
                  [disabled]="button.disabled"
                  [attr.aria-label]="button.ariaLabel || button.label || button.primaryDefaultText">
                  @if (button.icon) {
                    <span
                      class="workspace-dialog__toolbar-button-icon"
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

          <button
            type="button"
            class="workspace-dialog__close"
            (click)="cancel(activeDialog.id)"
            [disabled]="isBusy() || !isTopDialog(activeDialog.id)"
            [attr.aria-label]="activeDialog.cancelLabel || chill.T('C10CCB95-A6D7-40F1-ACAD-3A8F318958C2', 'Close dialog', 'Chiudi dialog')">
            x
          </button>
        </header>

        <div class="workspace-dialog__content">
          <ng-template #contentHost />
        </div>

        <footer class="workspace-dialog__bottom-bar">
          @if (errorMessage()) {
            <p class="workspace-dialog__error">{{ errorMessage() }}</p>
          }

          <div class="workspace-dialog__actions">
            @if (activeDialog.showCancelButton !== false) {
              <button type="button" class="workspace-dialog__button secondary" (click)="cancel(activeDialog.id)" [disabled]="isBusy() || !isTopDialog(activeDialog.id)">
                @if (activeDialog.cancelLabel) {
                  {{ activeDialog.cancelLabel }}
                } @else {
                  <app-chill-i18n-button-label [labelGuid]="'4DA4C4BA-0D5B-41B5-B49D-685D7C374D71'" [primaryDefaultText]="'Cancel'" [secondaryDefaultText]="'Annulla'" />
                }
              </button>
            }

            @if (activeDialog.showOkButton !== false) {
              <button type="button" class="workspace-dialog__button primary" (click)="confirm(activeDialog.id)" [disabled]="isBusy() || !isTopDialog(activeDialog.id) || !canConfirm()">
                {{ isBusy()
                  ? chill.T('08325F54-06AE-40E5-93EF-3C49B8E0B965', 'Working...', 'Elaborazione...')
                  : '' }}
                @if (!isBusy()) {
                  @if (activeDialog.okLabel) {
                    {{ activeDialog.okLabel }}
                  } @else {
                    <app-chill-i18n-button-label [labelGuid]="'AF183C6E-44B2-4CB3-97F7-01F0E7D01214'" [primaryDefaultText]="'OK'" [secondaryDefaultText]="'OK'" />
                  }
                }
                @if (isBusy()) {
                  <app-chill-i18n-button-label [labelGuid]="'08325F54-06AE-40E5-93EF-3C49B8E0B965'" [primaryDefaultText]="'Working...'" [secondaryDefaultText]="'Elaborazione...'" />
                }
              </button>
            }
          </div>
        </footer>
        </section>
      }
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 40;
      pointer-events: none;
    }

    .workspace-dialog-backdrop,
    .workspace-dialog {
      pointer-events: auto;
    }

    .workspace-dialog-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(7, 15, 20, 0.45);
      backdrop-filter: blur(8px);
    }

    .workspace-dialog {
      position: absolute;
      top: 50%;
      left: 50%;
      width: min(72rem, calc(100vw - 2rem));
      max-height: calc(100vh - 2rem);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      transform: translate(-50%, -50%);
      border-radius: 1rem;
      border: 1px solid var(--border-color);
      background: var(--surface-3);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .workspace-dialog.is-background {
      pointer-events: none;
    }

    .workspace-dialog__toolbar,
    .workspace-dialog__bottom-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border-color);
      background: color-mix(in srgb, var(--surface-2) 88%, transparent);
    }

    .workspace-dialog__bottom-bar {
      border-top: 1px solid var(--border-color);
      border-bottom: 0;
    }

    .workspace-dialog__title p,
    .workspace-dialog__title h2 {
      margin: 0;
    }

    .workspace-dialog__title p {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 0.72rem;
      font-weight: 700;
    }

    .workspace-dialog__title h2 {
      margin-top: 0.25rem;
      font-size: 1.25rem;
    }

    .workspace-dialog__close,
    .workspace-dialog__button {
      border: 0;
      cursor: pointer;
      font: inherit;
    }

    .workspace-dialog__toolbar-actions {
      display: flex;
      flex: 1 1 auto;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 0.65rem;
    }

    .workspace-dialog__toolbar-button {
      min-height: 2.5rem;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--border-color);
      border-radius: 999px;
      background: var(--surface-0);
      color: var(--text-main);
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }

    .workspace-dialog__toolbar-button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .workspace-dialog__toolbar-button-icon {
      font-size: 0.8rem;
    }

    .workspace-dialog__close {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: 0.8rem;
      background: var(--surface-2);
      color: var(--text-main);
    }

    .workspace-dialog__content {
      min-height: 0;
      overflow: auto;
      padding: 1.25rem;
    }

    .workspace-dialog__actions {
      margin-left: auto;
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .workspace-dialog__button {
      min-height: 2.9rem;
      padding: 0.75rem 1.1rem;
      border-radius: 0.8rem;
      font-weight: 700;
    }

    .workspace-dialog__button.secondary {
      border: 1px solid var(--border-color);
      background: var(--surface-0);
      color: var(--text-main);
    }

    .workspace-dialog__button.primary {
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      color: var(--surface-0);
    }

    .workspace-dialog__error {
      margin: 0;
      color: var(--danger);
      max-width: 100%;
      max-height: 5rem;
      overflow-x: hidden;
      overflow-y: auto;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    @media (max-width: 720px) {
      .workspace-dialog {
        width: calc(100vw - 1rem);
        max-height: calc(100vh - 1rem);
      }

      .workspace-dialog__toolbar,
      .workspace-dialog__bottom-bar,
      .workspace-dialog__content {
        padding: 0.9rem;
      }

      .workspace-dialog__toolbar {
        flex-wrap: wrap;
      }

      .workspace-dialog__toolbar-actions {
        width: 100%;
        justify-content: stretch;
      }

      .workspace-dialog__bottom-bar {
        flex-direction: column;
        align-items: stretch;
      }

      .workspace-dialog__actions {
        width: 100%;
      }

      .workspace-dialog__button {
        flex: 1 1 0;
      }

      .workspace-dialog__toolbar-button {
        flex: 1 1 10rem;
        justify-content: center;
      }
    }
  `
})
export class WorkspaceDialogHostComponent {
  readonly chill = inject(ChillService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly toolbar = inject(WorkspaceToolbarService);

  private readonly contentHosts = viewChildren('contentHost', { read: ViewContainerRef });

  readonly isBusy = signal(false);
  readonly errorMessage = signal('');
  readonly toolbarButtons = computed(() => this.toolbar.buttons('dialog'));

  private readonly contentRefs = new Map<number, ComponentRef<unknown>>();
  private readonly activeDialog = computed(() => this.dialog.activeDialog());
  private activeDialogId = 0;

  constructor() {
    effect(() => {
      const activeDialog = this.activeDialog();
      const activeDialogId = activeDialog?.id ?? 0;
      if (activeDialogId !== this.activeDialogId) {
        this.activeDialogId = activeDialogId;
        this.isBusy.set(false);
        this.errorMessage.set('');
      }
    });

    effect(() => {
      const dialogs = this.dialog.dialogs();
      const hosts = this.contentHosts();
      if (hosts.length < dialogs.length) {
        return;
      }

      const liveDialogIds = new Set(dialogs.map((activeDialog) => activeDialog.id));
      for (const [dialogId, contentRef] of this.contentRefs) {
        if (liveDialogIds.has(dialogId)) {
          continue;
        }

        contentRef.destroy();
        this.contentRefs.delete(dialogId);
      }

      dialogs.forEach((activeDialog, index) => {
        if (this.contentRefs.has(activeDialog.id)) {
          return;
        }

        const host = hosts[index];
        if (!host) {
          return;
        }

        host.clear();
        const contentRef = host.createComponent(activeDialog.component);
        for (const [key, value] of Object.entries(activeDialog.inputs ?? {})) {
          contentRef.setInput(key, value);
        }
        this.contentRefs.set(activeDialog.id, contentRef);
      });
    });
  }

  isTopDialog(dialogId: number): boolean {
    return this.activeDialog()?.id === dialogId;
  }

  cancel(dialogId?: number): void {
    if (this.isBusy() || (dialogId !== undefined && !this.isTopDialog(dialogId))) {
      return;
    }

    this.dialog.cancel();
  }

  async confirm(dialogId?: number): Promise<void> {
    if (this.isBusy() || (dialogId !== undefined && !this.isTopDialog(dialogId))) {
      return;
    }

    const activeDialog = this.activeDialog();
    if (!activeDialog) {
      return;
    }

    const contentRef = this.contentRefs.get(activeDialog.id) ?? null;
    this.errorMessage.set('');

    try {
      const componentInstance = contentRef?.instance;
      if (this.isDialogSubmitter(componentInstance)) {
        await componentInstance.submit();
        return;
      }

      this.isBusy.set(true);
      const value = this.isDialogTask(componentInstance)
        ? await componentInstance.dialogResult?.()
        : undefined;

      this.dialog.confirm(value);
    } catch (error) {
      this.errorMessage.set(this.chill.formatError(error));
      this.isBusy.set(false);
    }
  }

  canConfirm(): boolean {
    const activeDialog = this.activeDialog();
    const componentInstance = activeDialog
      ? this.contentRefs.get(activeDialog.id)?.instance
      : null;
    return this.isDialogSubmitter(componentInstance)
      ? (componentInstance.canDialogSubmit?.() ?? true)
      : true;
  }

  private isDialogTask(value: unknown): value is WorkspaceTaskComponent<unknown> {
    return !!value && typeof value === 'object' && 'dialogResult' in value;
  }

  private isDialogSubmitter(value: unknown): value is DialogSubmitComponent {
    return !!value && typeof value === 'object' && 'submit' in value && typeof value.submit === 'function';
  }
}
