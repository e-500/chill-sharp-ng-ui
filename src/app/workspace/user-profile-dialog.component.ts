import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { AuthUserDetailsResponse, JsonValue } from 'chill-sharp-ng-client';
import { firstValueFrom } from 'rxjs';
import { ChillPolymorphicInputComponent } from '../lib/chill-polymorphic-input.component';
import { CHILL_PROPERTY_TYPE, type ChillPropertySchema, type ChillSchema } from '../models/chill-schema.models';
import type { UpdateUserProfileRequest } from '../models/chill-auth.models';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillService } from '../services/chill.service';

type UserProfileFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

@Component({
  selector: 'app-user-profile-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChillPolymorphicInputComponent],
  template: `
    <section class="user-profile-dialog">
      <p class="user-profile-dialog__lede">
        {{ chill.T(
          '90F2A89E-7E41-449B-B8DA-934ECA76E4B8',
          'Update your personal preferences and save them to your account.',
          'Aggiorna le tue preferenze personali e salvale nel tuo account.'
        ) }}
      </p>

      @if (loadError()) {
        <p class="user-profile-dialog__message user-profile-dialog__message--error">{{ loadError() }}</p>
      } @else if (isLoading()) {
        <p class="user-profile-dialog__message">
          {{ chill.T('B58564E5-6F58-4068-812F-B1A9344E474F', 'Loading user profile...', 'Caricamento profilo utente...') }}
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

    .user-profile-dialog {
      display: grid;
      gap: 1rem;
    }

    .user-profile-dialog__lede,
    .user-profile-dialog__message {
      margin: 0;
      color: var(--text-muted);
    }

    .user-profile-dialog__message--error {
      color: var(--danger);
    }
  `
})
export class UserProfileDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly userGuid = input('');

  readonly isLoading = signal(true);
  readonly isValid = signal(true);
  readonly loadError = signal('');
  readonly user = signal<AuthUserDetailsResponse | null>(null);
  readonly schema = computed<ChillSchema>(() => ({
    chillType: 'Auth.User',
    chillViewCode: 'dialog',
    displayName: this.chill.T('EF63959A-FF5D-4AC5-8AE5-BEB27B2FAE90', 'User profile', 'Profilo utente'),
    metadata: {},
    properties: this.properties
  }));

  readonly form: UserProfileFormGroup = new FormGroup<Record<string, FormControl<JsonValue>>>({
    displayName: new FormControl<JsonValue>('', { nonNullable: true }),
    displayCultureName: new FormControl<JsonValue>('', { nonNullable: true }),
    displayTimeZone: new FormControl<JsonValue>('', { nonNullable: true }),
    displayDateFormat: new FormControl<JsonValue>('', { nonNullable: true }),
    displayNumberFormat: new FormControl<JsonValue>('', { nonNullable: true })
  });

  private readonly properties: ChillPropertySchema[] = [
    {
      name: 'displayName',
      displayName: this.chill.T('4971B652-5F24-4D38-9D9B-6D9BCE10BCB0', 'Display name', 'Nome visualizzato'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '255' }
    },
    {
      name: 'displayCultureName',
      displayName: this.chill.T('771A6B48-7330-4852-A6B5-5BD314EC5662', 'Culture', 'Cultura'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '64' }
    },
    {
      name: 'displayTimeZone',
      displayName: this.chill.T('98E424F1-0183-4D9E-9B69-CDB16EBD41CF', 'Time zone', 'Fuso orario'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '128' }
    },
    {
      name: 'displayDateFormat',
      displayName: this.chill.T('49988673-8DBD-4C2B-9430-DA3054F0E294', 'Date format', 'Formato data'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '64' }
    },
    {
      name: 'displayNumberFormat',
      displayName: this.chill.T('22A3BF58-7889-4AD7-A9EF-06B6A69A8D3C', 'Number format', 'Formato numerico'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '64' }
    }
  ];

  constructor() {
    effect(() => {
      const userGuid = this.userGuid().trim();
      if (!userGuid) {
        this.isLoading.set(false);
        this.loadError.set(this.chill.T(
          'A7EC70B4-4788-4850-A135-8743E2D9D86B',
          'The current user identifier is unavailable.',
          'L identificatore dell utente corrente non e disponibile.'
        ));
        return;
      }

      this.isLoading.set(true);
      this.loadError.set('');

      void this.loadUser(userGuid);
    });
  }

  canDialogSubmit(): boolean {
    return !this.isLoading() && !this.loadError() && this.isValid();
  }

  async submit(): Promise<void> {
    const userGuid = this.userGuid().trim();
    const currentUser = this.user();
    if (!userGuid || !currentUser || !this.canDialogSubmit()) {
      return;
    }

    const request: UpdateUserProfileRequest = {
      displayName: this.readString('displayName'),
      displayCultureName: this.readString('displayCultureName'),
      displayTimeZone: this.readString('displayTimeZone'),
      displayDateFormat: this.readString('displayDateFormat'),
      displayNumberFormat: this.readString('displayNumberFormat')
    };

    await firstValueFrom(this.chill.updateUserProfile(userGuid, request));
    this.dialog.confirm(request);
  }

  private async loadUser(userGuid: string): Promise<void> {
    try {
      const user = await firstValueFrom(this.chill.getAuthUserDetails(userGuid));
      this.user.set(user);
      this.form.controls['displayName'].setValue(user.displayName ?? '');
      this.form.controls['displayCultureName'].setValue(user.displayCultureName ?? '');
      this.form.controls['displayTimeZone'].setValue(user.displayTimeZone ?? '');
      this.form.controls['displayDateFormat'].setValue(user.displayDateFormat ?? '');
      this.form.controls['displayNumberFormat'].setValue(user.displayNumberFormat ?? '');
    } catch (error) {
      this.user.set(null);
      this.loadError.set(this.chill.formatError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private readString(controlName: string): string {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' ? value.trim() : '';
  }
}
