import { CommonModule } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import { firstValueFrom } from 'rxjs';
import { ChillService } from '../../services/chill.service';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';

interface AttachmentUploadFormValue {
  title: FormControl<string>;
  description: FormControl<string>;
  isPublic: FormControl<boolean>;
}

@Component({
  selector: 'app-attachment-upload-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <section class="attachment-upload-dialog">
      <p class="attachment-upload-dialog__lede">
        {{ chill.T(
          '47A55AC3-9013-4A7E-81C4-E549EFE248E8',
          'Upload one attachment for the selected entity.',
          'Carica un allegato per l entita selezionata.'
        ) }}
      </p>

      <p class="attachment-upload-dialog__target">
        <strong>{{ attachToChillType() }}</strong>
        <span>{{ attachToGuid() }}</span>
      </p>

      <label class="attachment-upload-dialog__field">
        <span>{{ chill.T('E9E11821-898B-449D-BF17-E7136CB737D9', 'File', 'File') }}</span>
        <input type="file" (change)="onFileSelected($event)" />
      </label>

      @if (selectedFileName()) {
        <p class="attachment-upload-dialog__file">{{ selectedFileName() }}</p>
      }

      <form [formGroup]="form" class="attachment-upload-dialog__form">
        <label class="attachment-upload-dialog__field">
          <span>{{ chill.T('92C31A96-D747-490D-8A4D-2175C181E80C', 'Title', 'Titolo') }}</span>
          <input type="text" formControlName="title" />
        </label>

        <label class="attachment-upload-dialog__field">
          <span>{{ chill.T('D679D4D4-FB4E-474B-848C-5BBBE38A4F0C', 'Description', 'Descrizione') }}</span>
          <textarea rows="4" formControlName="description"></textarea>
        </label>

        <label class="attachment-upload-dialog__checkbox">
          <input type="checkbox" formControlName="isPublic" />
          <span>{{ chill.T('BC4B1775-3937-4B56-9EF2-A4F1962A5AF7', 'Public', 'Pubblico') }}</span>
        </label>
      </form>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .attachment-upload-dialog {
      display: grid;
      gap: 1rem;
    }

    .attachment-upload-dialog__lede,
    .attachment-upload-dialog__target,
    .attachment-upload-dialog__file {
      margin: 0;
    }

    .attachment-upload-dialog__lede,
    .attachment-upload-dialog__target span,
    .attachment-upload-dialog__file {
      color: var(--text-muted);
    }

    .attachment-upload-dialog__target {
      display: grid;
      gap: 0.25rem;
    }

    .attachment-upload-dialog__target strong {
      color: var(--text-main);
    }

    .attachment-upload-dialog__form {
      display: grid;
      gap: 1rem;
    }

    .attachment-upload-dialog__field {
      display: grid;
      gap: 0.45rem;
    }

    .attachment-upload-dialog__field input,
    .attachment-upload-dialog__field textarea {
      width: 100%;
      padding: 0.75rem 0.85rem;
      border: 1px solid var(--border-color);
      border-radius: 0.75rem;
      background: var(--surface-0);
      color: var(--text-main);
      font: inherit;
    }

    .attachment-upload-dialog__checkbox {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
    }
  `
})
export class AttachmentUploadDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly attachToChillType = input('');
  readonly attachToGuid = input('');

  readonly form = new FormGroup<AttachmentUploadFormValue>({
    title: new FormControl('', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    isPublic: new FormControl(false, { nonNullable: true })
  });

  readonly selectedFile = signal<File | null>(null);
  readonly selectedFileName = signal('');

  canDialogSubmit(): boolean {
    return !!this.selectedFile() && !!this.attachToChillType().trim() && !!this.attachToGuid().trim();
  }

  async submit(): Promise<void> {
    const file = this.selectedFile();
    const attachToChillType = this.attachToChillType().trim();
    const attachToGuid = this.attachToGuid().trim();
    if (!file || !attachToChillType || !attachToGuid) {
      return;
    }

    const uploaded = await firstValueFrom(this.chill.uploadAttachment(
      {
        chillType: attachToChillType,
        guid: attachToGuid
      } as JsonObject,
      {
        fileName: file.name,
        content: file,
        contentType: file.type || undefined
      },
      {
        title: this.form.controls.title.value.trim() || null,
        description: this.form.controls.description.value.trim() || null,
        isPublic: this.form.controls.isPublic.value
      }
    ));

    this.dialog.confirm(uploaded[0] ?? null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.selectedFileName.set(file?.name ?? '');

    if (file && !this.form.controls.title.value.trim()) {
      const fileName = file.name.replace(/\.[^.]+$/, '').trim();
      this.form.controls.title.setValue(fileName || file.name);
    }
  }
}
