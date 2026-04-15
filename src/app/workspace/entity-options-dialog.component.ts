import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { ChillDtoEntityOptions, JsonValue } from 'chill-sharp-ng-client';
import { firstValueFrom } from 'rxjs';
import { ChillPolymorphicInputComponent } from '../lib/chill-polymorphic-input.component';
import { CHILL_PROPERTY_TYPE, type ChillMetadataRecord, type ChillPropertySchema, type ChillSchema } from '../models/chill-schema.models';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillService } from '../services/chill.service';

type EntityOptionsFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

@Component({
  selector: 'app-entity-options-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChillPolymorphicInputComponent],
  template: `
    <section class="entity-options-dialog">
      <p class="entity-options-dialog__lede">
        {{ chill.T(
          'A63A8D6A-85B4-48A3-822D-AF4F6C67D5AA',
          'Update the entity behavior and label formatting used by the selected CRUD type.',
          'Aggiorna il comportamento dell entita e la formattazione delle etichette usata dal tipo CRUD selezionato.'
        ) }}
      </p>

      <p class="entity-options-dialog__type">
        {{ chill.T('E17E30B7-A5A7-4A29-AE1F-9AC4F7F752AB', 'Entity type', 'Tipo entita') }}:
        <strong>{{ chillType() }}</strong>
      </p>

      @if (loadError()) {
        <p class="entity-options-dialog__message entity-options-dialog__message--error">{{ loadError() }}</p>
      } @else if (isLoading()) {
        <p class="entity-options-dialog__message">
          {{ chill.T('F60D8E5F-A52A-44C1-A6D5-7B59AF04B3D5', 'Loading entity options...', 'Caricamento opzioni entita...') }}
        </p>
      } @else {
        <app-chill-polymorphic-input
          [form]="form"
          [schema]="schema()"
          [showLabels]="true"
          (validityChange)="isValid.set($event)"></app-chill-polymorphic-input>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .entity-options-dialog {
      display: grid;
      gap: 1rem;
    }

    .entity-options-dialog__lede,
    .entity-options-dialog__type,
    .entity-options-dialog__message {
      margin: 0;
      color: var(--text-muted);
    }

    .entity-options-dialog__type strong {
      color: var(--text-main);
    }

    .entity-options-dialog__message--error {
      color: var(--danger);
    }
  `
})
export class EntityOptionsDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly chillType = input('');
  readonly displayName = input('');

  readonly isLoading = signal(true);
  readonly isValid = signal(true);
  readonly loadError = signal('');
  readonly entityOptions = signal<ChillDtoEntityOptions | null>(null);
  readonly schema = computed<ChillSchema>(() => ({
    chillType: this.chillType().trim() || 'Entity.Options',
    chillViewCode: 'dialog',
    displayName: this.displayName().trim() || this.chill.T('F03D0E56-1B98-40C3-80E0-33054E81A020', 'Entity options', 'Opzioni entita'),
    metadata: {},
    properties: this.properties
  }));

  readonly form: EntityOptionsFormGroup = new FormGroup<Record<string, FormControl<JsonValue>>>({
    checksumEnabled: new FormControl<JsonValue>(false, { nonNullable: true }),
    handleAttachments: new FormControl<JsonValue>(false, { nonNullable: true }),
    labelFormatString: new FormControl<JsonValue>('', { nonNullable: true }),
    shortLabelFormatString: new FormControl<JsonValue>('', { nonNullable: true }),
    fullTextContentFormatString: new FormControl<JsonValue>('', { nonNullable: true }),
    changeLogEnabled: new FormControl<JsonValue>(false, { nonNullable: true })
  });

  private readonly properties: ChillPropertySchema[] = [
    {
      name: 'checksumEnabled',
      displayName: this.chill.T('A479967A-677D-4F6E-A979-4597AE47FA97', 'Checksum enabled', 'Checksum abilitato'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {} as ChillMetadataRecord
    },
    {
      name: 'handleAttachments',
      displayName: this.chill.T('64A3253C-1767-4384-A27A-D2A13FDC1634', 'Handle attachments', 'Gestisci allegati'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {} as ChillMetadataRecord
    },
    {
      name: 'labelFormatString',
      displayName: this.chill.T('DA742D97-35D6-4F9F-9E58-3D476C9DA5A4', 'Label format string', 'Formato etichetta'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      metadata: { maxLength: '4000' } as ChillMetadataRecord
    },
    {
      name: 'shortLabelFormatString',
      displayName: this.chill.T('7FCB4208-0CD6-450F-9028-D5A1CC185610', 'Short label format string', 'Formato etichetta breve'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      metadata: { maxLength: '4000' } as ChillMetadataRecord
    },
    {
      name: 'fullTextContentFormatString',
      displayName: this.chill.T('B79CA08C-3E94-45FC-B2B2-9A6B2E630B01', 'Full text content format string', 'Formato contenuto full text'),
      propertyType: CHILL_PROPERTY_TYPE.Text,
      isNullable: true,
      metadata: { maxLength: '4000' } as ChillMetadataRecord
    },
    {
      name: 'changeLogEnabled',
      displayName: this.chill.T('CC8E9A2C-4A5B-48B3-9FA8-489F73F149E5', 'Change log enabled', 'Change log abilitato'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {} as ChillMetadataRecord
    }
  ];

  constructor() {
    effect(() => {
      const chillType = this.chillType().trim();
      if (!chillType) {
        this.isLoading.set(false);
        this.loadError.set(this.chill.T(
          '0F90C3B9-A9B7-4FFB-9465-D07D66737AA4',
          'The selected entity type is unavailable.',
          'Il tipo entita selezionato non e disponibile.'
        ));
        return;
      }

      this.isLoading.set(true);
      this.loadError.set('');
      void this.loadEntityOptions(chillType);
    });
  }

  canDialogSubmit(): boolean {
    return !this.isLoading() && !this.loadError() && this.isValid();
  }

  async submit(): Promise<void> {
    const currentOptions = this.entityOptions();
    const chillType = this.chillType().trim();
    if (!currentOptions || !chillType || !this.canDialogSubmit()) {
      return;
    }

    const payload: ChillDtoEntityOptions = {
      chillType,
      checksumEnabled: this.readBoolean('checksumEnabled'),
      handleAttachments: this.readBoolean('handleAttachments'),
      labelFormatString: this.readOptionalString('labelFormatString'),
      shortLabelFormatString: this.readOptionalString('shortLabelFormatString'),
      fullTextContentFormatString: this.readOptionalString('fullTextContentFormatString'),
      changeLogEnabled: this.readBoolean('changeLogEnabled')
    };

    const savedOptions = await firstValueFrom(this.chill.setEntityOptions(payload));
    this.entityOptions.set(savedOptions);
    this.dialog.confirm(savedOptions);
  }

  private async loadEntityOptions(chillType: string): Promise<void> {
    try {
      const entityOptions = await firstValueFrom(this.chill.getEntityOptions(chillType));
      this.entityOptions.set(entityOptions);
      this.form.controls['checksumEnabled'].setValue(entityOptions.checksumEnabled);
      this.form.controls['handleAttachments'].setValue(entityOptions.handleAttachments);
      this.form.controls['labelFormatString'].setValue(entityOptions.labelFormatString ?? '');
      this.form.controls['shortLabelFormatString'].setValue(entityOptions.shortLabelFormatString ?? '');
      this.form.controls['fullTextContentFormatString'].setValue(entityOptions.fullTextContentFormatString ?? '');
      this.form.controls['changeLogEnabled'].setValue(entityOptions.changeLogEnabled);
    } catch (error) {
      this.entityOptions.set(null);
      this.loadError.set(this.chill.formatError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private readOptionalString(controlName: string): string | null {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private readBoolean(controlName: string): boolean {
    return this.form.controls[controlName].value === true;
  }
}
