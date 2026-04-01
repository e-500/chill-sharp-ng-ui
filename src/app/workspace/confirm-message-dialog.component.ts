import { CommonModule } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';

export interface ConfirmMessageDialogButton<TResult = unknown> {
  label: string;
  value: TResult;
  primary?: boolean;
}

@Component({
  selector: 'app-confirm-message-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="confirm-message-dialog">
      @if (description()) {
        <p class="confirm-message-dialog__description">{{ description() }}</p>
      }

      <div class="confirm-message-dialog__actions">
        @for (button of buttons(); track $index) {
          <button
            type="button"
            class="confirm-message-dialog__button"
            [class.primary]="button.primary === true"
            [class.secondary]="button.primary !== true"
            (click)="select(button.value)">
            {{ button.label }}
          </button>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .confirm-message-dialog {
      display: grid;
      gap: 1rem;
    }

    .confirm-message-dialog__description {
      margin: 0;
      color: var(--text-main);
      line-height: 1.5;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .confirm-message-dialog__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .confirm-message-dialog__button {
      min-height: 2.9rem;
      padding: 0.75rem 1.1rem;
      border-radius: 0.8rem;
      border: 1px solid var(--border-color);
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }

    .confirm-message-dialog__button.secondary {
      background: var(--surface-0);
      color: var(--text-main);
    }

    .confirm-message-dialog__button.primary {
      border-color: transparent;
      background: linear-gradient(135deg, var(--accent), var(--accent-strong));
      color: var(--surface-0);
    }

    @media (max-width: 720px) {
      .confirm-message-dialog__actions {
        display: grid;
      }
    }
  `
})
export class ConfirmMessageDialogComponent {
  readonly dialog = inject(WorkspaceDialogService);
  readonly description = input('');
  readonly buttons = input<ConfirmMessageDialogButton[]>([]);

  select(value: unknown): void {
    this.dialog.confirm(value);
  }
}
