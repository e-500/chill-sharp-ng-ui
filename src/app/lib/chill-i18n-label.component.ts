import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChillService } from '../services/chill.service';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';

@Component({
  selector: 'app-chill-i18n-label',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <span class="i18n-label" [class.edit-enabled]="editEnabled()">
      @if (isEditing()) {
        <input
          type="text"
          class="i18n-label__input"
          [ngModel]="draftText()"
          (ngModelChange)="draftText.set($event)"
          [disabled]="isSaving()"
          [attr.aria-label]="editAriaLabel()"
          (keydown.enter)="save()"
          (keydown.escape)="cancel()" />

        <button
          type="button"
          class="i18n-label__action confirm"
          (click)="save()"
          [disabled]="isSaving() || !canSave()"
          [attr.aria-label]="saveAriaLabel()">
          ✓
        </button>
      } @else {
        <span class="i18n-label__text">{{ text() }}</span>

        @if (editEnabled()) {
          <button
            type="button"
            class="i18n-label__action edit"
            (click)="startEditing()"
            [attr.aria-label]="editAriaLabel()">
            ✎
          </button>
        }
      }
    </span>

    @if (errorMessage()) {
      <small class="i18n-label__error">{{ errorMessage() }}</small>
    }
  `,
  styleUrl: './chill-i18n-label.component.scss'
})
export class ChillI18nLabelComponent {
  readonly chill = inject(ChillService);
  readonly layout = inject(WorkspaceLayoutService);

  readonly labelGuid = input.required<string>();
  readonly primaryDefaultText = input.required<string>();
  readonly secondaryDefaultText = input.required<string>();
  readonly editable = input(true);

  readonly isEditing = signal(false);
  readonly isSaving = signal(false);
  readonly draftText = signal('');
  readonly errorMessage = signal('');

  readonly text = computed(() => this.chill.T(this.labelGuid(), this.primaryDefaultText(), this.secondaryDefaultText()));
  readonly editEnabled = computed(() => this.editable() && this.chill.isAuthenticated() && this.layout.isLayoutEditingEnabled());
  readonly canSave = computed(() => this.draftText().trim().length > 0 && this.draftText().trim() !== this.text().trim());
  readonly editAriaLabel = computed(() =>
    this.chill.T('F7FD0AA5-3E6E-491C-857A-5C6C5C7119D5', 'Edit label', 'Modifica etichetta')
  );
  readonly saveAriaLabel = computed(() =>
    this.chill.T('1A77383B-6A11-489A-B527-0CD15A9DBE84', 'Save label', 'Salva etichetta')
  );

  startEditing(): void {
    if (!this.editEnabled()) {
      return;
    }

    this.draftText.set(this.text());
    this.errorMessage.set('');
    this.isEditing.set(true);
  }

  cancel(): void {
    if (this.isSaving()) {
      return;
    }

    this.isEditing.set(false);
    this.errorMessage.set('');
    this.draftText.set(this.text());
  }

  save(): void {
    if (!this.canSave() || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');

    this.chill.setText(this.labelGuid(), this.draftText().trim()).subscribe({
      next: (value) => {
        this.draftText.set(value);
        this.isSaving.set(false);
        this.isEditing.set(false);
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.chill.formatError(error));
        this.isSaving.set(false);
      }
    });
  }
}
