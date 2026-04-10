import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { JsonValue } from 'chill-sharp-ng-client';
import { firstValueFrom } from 'rxjs';
import { ChillPolymorphicInputComponent } from '../../lib/chill-polymorphic-input.component';
import type { CreateAuthRoleRequest, UpdateAuthRoleRequest } from '../../models/chill-auth.models';
import { CHILL_PROPERTY_TYPE, type ChillPropertySchema, type ChillSchema } from '../../models/chill-schema.models';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { ChillService } from '../../services/chill.service';

type AuthRoleFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

@Component({
  selector: 'app-auth-role-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChillPolymorphicInputComponent],
  template: `
    <section class="auth-entity-dialog">
      <p class="auth-entity-dialog__lede">
        {{ isEditMode()
          ? chill.T('65FB65D7-7D87-4661-9AD4-0FE7384983E7', 'Update role details and save the changes.', 'Aggiorna i dettagli ruolo e salva le modifiche.')
          : chill.T('C1264E7A-11D0-44E2-9026-2A1AA6F9AF82', 'Create a new role and use it immediately in permission assignments.', 'Crea un nuovo ruolo e usalo subito nelle assegnazioni dei permessi.') }}
      </p>

      @if (loadError()) {
        <p class="auth-entity-dialog__message auth-entity-dialog__message--error">{{ loadError() }}</p>
      } @else if (isLoading()) {
        <p class="auth-entity-dialog__message">
          {{ chill.T('39994747-E0B9-4404-BF92-CB98BA434832', 'Loading role details...', 'Caricamento dettagli ruolo...') }}
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
export class AuthRoleDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly roleGuid = input('');

  readonly isLoading = signal(false);
  readonly isValid = signal(true);
  readonly loadError = signal('');
  readonly isEditMode = computed(() => !!this.roleGuid().trim());
  readonly schema = computed<ChillSchema>(() => ({
    chillType: 'Auth.Role',
    chillViewCode: 'dialog',
    displayName: this.isEditMode()
      ? this.chill.T('6E9A69C0-C4A1-433A-97BC-9E8D1CBD2B53', 'Edit', 'Modifica')
      : this.chill.T('0B47EAA4-33BC-4D1C-B8C6-F75D3A5C8864', 'Create role', 'Crea ruolo'),
    metadata: {},
    properties: this.properties
  }));

  readonly form: AuthRoleFormGroup = new FormGroup<Record<string, FormControl<JsonValue>>>({
    name: new FormControl<JsonValue>('', { nonNullable: true }),
    description: new FormControl<JsonValue>('', { nonNullable: true }),
    isActive: new FormControl<JsonValue>(true, { nonNullable: true })
  });

  private readonly properties: ChillPropertySchema[] = [
    {
      name: 'name',
      displayName: this.chill.T('7767C44A-8F47-4E39-BB2A-0B297887A0D3', 'Name', 'Nome'),
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '255' }
    },
    {
      name: 'description',
      displayName: this.chill.T('97A7BFE7-22A7-4665-B0D8-C75506A8F794', 'Description', 'Descrizione'),
      propertyType: CHILL_PROPERTY_TYPE.Text,
      isNullable: true,
      metadata: { maxLength: '1000', multiline: 'true' }
    },
    {
      name: 'isActive',
      displayName: this.chill.T('7A2D49F9-9A14-4FD1-8A8B-9B604CA3796C', 'Role is active', 'Ruolo attivo'),
      propertyType: CHILL_PROPERTY_TYPE.Boolean,
      isNullable: false,
      metadata: {}
    }
  ];

  constructor() {
    effect(() => {
      const roleGuid = this.roleGuid().trim();
      this.loadError.set('');

      if (!roleGuid) {
        this.isLoading.set(false);
        this.populateForm({
          name: '',
          description: '',
          isActive: true
        });
        return;
      }

      this.isLoading.set(true);
      void this.loadRole(roleGuid);
    });
  }

  canDialogSubmit(): boolean {
    return !this.isLoading() && !this.loadError() && this.isValid();
  }

  async submit(): Promise<void> {
    if (!this.canDialogSubmit()) {
      return;
    }

    const roleGuid = this.roleGuid().trim();
    const payload = this.readPayload();
    const savedRole = roleGuid
      ? await firstValueFrom(this.chill.updateAuthRole(roleGuid, payload as UpdateAuthRoleRequest))
      : await firstValueFrom(this.chill.createAuthRole(payload));

    this.dialog.confirm(savedRole);
  }

  private async loadRole(roleGuid: string): Promise<void> {
    try {
      const role = await firstValueFrom(this.chill.getAuthRoleAccess(roleGuid));
      this.populateForm({
        name: role.role.name,
        description: role.role.description,
        isActive: role.role.isActive
      });
    } catch (error) {
      this.loadError.set(this.chill.formatError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private populateForm(role: CreateAuthRoleRequest): void {
    this.form.controls['name'].setValue(role.name);
    this.form.controls['description'].setValue(role.description);
    this.form.controls['isActive'].setValue(role.isActive);
  }

  private readPayload(): CreateAuthRoleRequest {
    return {
      name: this.readString('name'),
      description: this.readString('description'),
      isActive: this.form.controls['isActive'].value === true
    };
  }

  private readString(controlName: string): string {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' ? value.trim() : '';
  }
}
