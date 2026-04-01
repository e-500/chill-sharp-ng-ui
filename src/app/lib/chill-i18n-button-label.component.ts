import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChillService } from '../services/chill.service';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';

@Component({
  selector: 'app-chill-i18n-button-label',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <span class="i18n-button-label">
      @if (isEditing()) {
        <input
          type="text"
          class="i18n-button-label__input"
          [ngModel]="draftText()"
          (ngModelChange)="draftText.set($event)"
          [disabled]="isSaving()"
          [attr.aria-label]="editAriaLabel()"
          (click)="swallow($event)"
          (mousedown)="swallow($event)"
          (keydown.enter)="save($event)"
          (keydown.escape)="cancel($event)" />

        <span
          class="i18n-button-label__action confirm"
          role="button"
          tabindex="0"
          [attr.aria-disabled]="isSaving() || !canSave()"
          [attr.aria-label]="saveAriaLabel()"
          (click)="save($event)"
          (mousedown)="swallow($event)"
          (keydown.enter)="save($event)"
          (keydown.space)="save($event)">
          ✓
        </span>
      } @else {
        <span class="i18n-button-label__text">{{ text() }}</span>

        @if (editEnabled()) {
          <span
            class="i18n-button-label__action edit"
            role="button"
            tabindex="0"
            [attr.aria-label]="editAriaLabel()"
            (click)="startEditing($event)"
            (mousedown)="swallow($event)"
            (keydown.enter)="startEditing($event)"
            (keydown.space)="startEditing($event)">
            ✎
          </span>
        }
      }
    </span>

    @if (errorMessage()) {
      <small class="i18n-button-label__error">{{ errorMessage() }}</small>
    }
  `,
  styleUrl: './chill-i18n-button-label.component.scss'
})
export class ChillI18nButtonLabelComponent {
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
    this.chill.T('344781FB-FD8F-4127-A599-4EC92E466B19', 'Edit button label', 'Modifica etichetta pulsante')
  );
  readonly saveAriaLabel = computed(() =>
    this.chill.T('3B2D7D1E-AEA2-4412-9AE3-228BB2252D49', 'Save button label', 'Salva etichetta pulsante')
  );

  startEditing(event?: Event): void {
    this.swallow(event);
    if (!this.editEnabled()) {
      return;
    }

    this.draftText.set(this.text());
    this.errorMessage.set('');
    this.isEditing.set(true);
  }

  cancel(event?: Event): void {
    this.swallow(event);
    if (this.isSaving()) {
      return;
    }

    this.isEditing.set(false);
    this.errorMessage.set('');
    this.draftText.set(this.text());
  }

  save(event?: Event): void {
    this.swallow(event);
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

  swallow(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
  }
}
