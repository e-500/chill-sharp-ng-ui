import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { JsonValue } from 'chill-sharp-ng-client';
import { firstValueFrom } from 'rxjs';
import { getCultureNameOptions } from '../../lib/culture-name-options';
import { getDateFormatOptions } from '../../lib/date-format-options';
import { getIanaTimeZoneOptions } from '../../lib/iana-time-zone-options';
import { ChillPolymorphicInputComponent } from '../../lib/chill-polymorphic-input.component';
import type { AuthUser, CreateAuthUserRequest, UpdateAuthUserRequest } from '../../models/chill-auth.models';
import { CHILL_PROPERTY_TYPE, type ChillMetadataRecord, type ChillPropertySchema, type ChillSchema } from '../../models/chill-schema.models';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { ChillService } from '../../services/chill.service';

type AuthUserFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

@Component({
  selector: 'app-auth-user-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChillPolymorphicInputComponent],
  template: `
    <section class="auth-entity-dialog">
      <p class="auth-entity-dialog__lede">
        {{ isEditMode()
          ? chill.T('1D88DB28-33B4-4D07-97D0-3BD2D8DDF1D0', 'Update user details and save the changes.', 'Aggiorna i dettagli utente e salva le modifiche.')
          : chill.T('104D3BC3-A842-4929-BD05-EAAE482900AD', 'Create a new user and make it immediately available for permission editing.', 'Crea un nuovo utente e rendilo subito disponibile per la modifica dei permessi.') }}
      </p>

      @if (loadError()) {
        <p class="auth-entity-dialog__message auth-entity-dialog__message--error">{{ loadError() }}</p>
      } @else if (isLoading()) {
        <p class="auth-entity-dialog__message">
          {{ chill.T('B80FE0B4-3BB7-4A7E-B9EB-1A456E3A8F68', 'Loading user details...', 'Caricamento dettagli utente...') }}
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

    .auth-entity-dialog {
      display: grid;
      gap: 1rem;
    }

    .auth-entity-dialog__lede,
    .auth-entity-dialog__message {
      margin: 0;
      color: var(--text-muted);
    }

    .auth-entity-dialog__message--error {
      color: var(--danger);
    }
  `
})
export class AuthUserDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly userGuid = input('');

  readonly isLoading = signal(false);
  readonly isValid = signal(true);
  readonly loadError = signal('');
  readonly isEditMode = computed(() => !!this.userGuid().trim());
  readonly schema = computed<ChillSchema>(() => ({
    chillType: 'Auth.User',
    chillViewCode: 'dialog',
    displayName: this.isEditMode()
      ? this.chill.T('C082531D-0F50-49D4-B677-C752D1A4DAA4', 'Edit user', 'Modifica utente')
      : this.chill.T('9E2BFF8D-BF6C-4C8D-BE6A-972425BA63DB', 'New user', 'Nuovo utente'),
    metadata: {},
    properties: this.properties
  }));

  readonly form: AuthUserFormGroup = new FormGroup<Record<string, FormControl<JsonValue>>>({
    externalId: new FormControl<JsonValue>('', { nonNullable: true }),
    userName: new FormControl<JsonValue>('', { nonNullable: true }),
    displayName: new FormControl<JsonValue>('', { nonNullable: true }),
    displayCultureName: new FormControl<JsonValue>('', { nonNullable: true }),
    displayTimeZone: new FormControl<JsonValue>('', { nonNullable: true }),
    displayDateFormat: new FormControl<JsonValue>('', { nonNullable: true }),
    displayNumberFormat: new FormControl<JsonValue>('', { nonNullable: true }),
    isActive: new FormControl<JsonValue>(true, { nonNullable: true }),
    canManagePermissions: new FormControl<JsonValue>(false, { nonNullable: true }),
    canManageSchema: new FormControl<JsonValue>(false, { nonNullable: true }),
    menuHierarchy: new FormControl<JsonValue>('', { nonNullable: true })
  });
  private readonly cultureNameOptions = getCultureNameOptions();
  private readonly dateFormatOptions = getDateFormatOptions();
  private readonly timeZoneOptions = getIanaTimeZoneOptions();

  private readonly properties: ChillPropertySchema[] = [
    {
      name: 'userName',
      displayName: this.chill.T('2AF5EB08-932E-4D4D-9338-75E1808B5F16', 'Username', 'Nome utente'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '255' }
    },
    {
      name: 'displayName',
      displayName: this.chill.T('C0D8A063-E084-460D-BF83-BCE32CB68588', 'Display name', 'Nome visualizzato'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '255' }
    },
    {
      name: 'externalId',
      displayName: this.chill.T('12FB2D99-C4BF-4F0A-9FD5-9C10AFB5B38A', 'External id', 'Id esterno'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      metadata: { maxLength: '255' }
    },
    {
      name: 'displayCultureName',
      displayName: this.chill.T('771A6B48-7330-4852-A6B5-5BD314EC5662', 'Culture', 'Cultura'),
      propertyType: CHILL_PROPERTY_TYPE.Select,
      isNullable: false,
      metadata: {
        required: 'true',
        options: this.cultureNameOptions
      } as ChillMetadataRecord
    },
    {
      name: 'displayTimeZone',
      displayName: this.chill.T('98E424F1-0183-4D9E-9B69-CDB16EBD41CF', 'Time zone', 'Fuso orario'),
      propertyType: CHILL_PROPERTY_TYPE.Select,
      isNullable: false,
      metadata: {
        required: 'true',
        options: this.timeZoneOptions
      } as ChillMetadataRecord
    },
    {
      name: 'displayDateFormat',
      displayName: this.chill.T('49988673-8DBD-4C2B-9430-DA3054F0E294', 'Date format', 'Formato data'),
      propertyType: CHILL_PROPERTY_TYPE.Select,
      isNullable: false,
      metadata: {
        required: 'true',
        options: this.dateFormatOptions
      } as ChillMetadataRecord
    },
    {
      name: 'displayNumberFormat',
      displayName: this.chill.T('22A3BF58-7889-4AD7-A9EF-06B6A69A8D3C', 'Number format', 'Formato numerico'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '64' }
    },
    {
      name: 'menuHierarchy',
      displayName: this.chill.T('D133779C-B96F-4DB8-9F4B-7FE8874228C9', 'Menu hierarchy', 'Gerarchia menu'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      metadata: { maxLength: '255' }
    },
    {
      name: 'isActive',
      displayName: this.chill.T('8159D7BE-FBAA-44EB-9B41-A72B5F38F34C', 'User is active', 'Utente attivo'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {}
    },
    {
      name: 'canManagePermissions',
      displayName: this.chill.T('3E834972-E367-492B-9C2E-14CFEDB3607E', 'Can manage permissions', 'Può gestire i permessi'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {}
    },
    {
      name: 'canManageSchema',
      displayName: this.chill.T('5BCDD500-C65B-45D7-8B5A-EC0D9B8B82DE', 'Can manage schema', 'Può gestire lo schema'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {}
    }
  ];

  constructor() {
    effect(() => {
      const userGuid = this.userGuid().trim();
      this.loadError.set('');

      if (!userGuid) {
        this.isLoading.set(false);
        this.populateForm(null);
        return;
      }

      this.isLoading.set(true);
      void this.loadUser(userGuid);
    });
  }

  canDialogSubmit(): boolean {
    return !this.isLoading() && !this.loadError() && this.isValid();
  }

  async submit(): Promise<void> {
    if (!this.canDialogSubmit()) {
      return;
    }

    const userGuid = this.userGuid().trim();
    const payload = this.readPayload();
    const savedUser = userGuid
      ? await firstValueFrom(this.chill.updateAuthUser(userGuid, payload as UpdateAuthUserRequest))
      : await firstValueFrom(this.chill.createAuthUser(payload));

    this.dialog.confirm(savedUser);
  }

  private async loadUser(userGuid: string): Promise<void> {
    try {
      const user = await firstValueFrom(this.chill.getAuthUserDetails(userGuid));
      this.populateForm(user);
    } catch (error) {
      this.loadError.set(this.chill.formatError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private populateForm(user: AuthUser | null): void {
    this.form.controls['externalId'].setValue(user?.externalId ?? '');
    this.form.controls['userName'].setValue(user?.userName ?? '');
    this.form.controls['displayName'].setValue(user?.displayName ?? '');
    this.form.controls['displayCultureName'].setValue(user?.displayCultureName ?? this.readBrowserCultureName());
    this.form.controls['displayTimeZone'].setValue(user?.displayTimeZone ?? this.readBrowserTimeZone());
    this.form.controls['displayDateFormat'].setValue(user?.displayDateFormat ?? 'dd/MM/yyyy');
    this.form.controls['displayNumberFormat'].setValue(user?.displayNumberFormat ?? 'it-IT');
    this.form.controls['isActive'].setValue(user?.isActive ?? true);
    this.form.controls['canManagePermissions'].setValue(user?.canManagePermissions ?? false);
    this.form.controls['canManageSchema'].setValue(user?.canManageSchema ?? false);
    this.form.controls['menuHierarchy'].setValue(user?.menuHierarchy ?? '');
  }

  private readPayload(): CreateAuthUserRequest {
    return {
      externalId: this.readString('externalId'),
      userName: this.readString('userName'),
      displayName: this.readString('displayName'),
      displayCultureName: this.readString('displayCultureName'),
      displayTimeZone: this.readString('displayTimeZone'),
      displayDateFormat: this.readString('displayDateFormat'),
      displayNumberFormat: this.readString('displayNumberFormat'),
      isActive: this.readBoolean('isActive'),
      canManagePermissions: this.readBoolean('canManagePermissions'),
      canManageSchema: this.readBoolean('canManageSchema'),
      menuHierarchy: this.readString('menuHierarchy')
    };
  }

  private readString(controlName: string): string {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' ? value.trim() : '';
  }

  private readBoolean(controlName: string): boolean {
    return this.form.controls[controlName].value === true;
  }

  private readBrowserCultureName(): string {
    const languages = globalThis.navigator?.languages;
    const browserCultureName = languages?.find((language) => typeof language === 'string' && language.trim())
      ?? globalThis.navigator?.language
      ?? '';
    return browserCultureName.trim() || 'it-IT';
  }

  private readBrowserTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}
