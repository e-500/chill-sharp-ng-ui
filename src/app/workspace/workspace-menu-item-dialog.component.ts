import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { JsonValue } from 'chill-sharp-ng-client';
import { ChillPolymorphicInputComponent } from '../lib/chill-polymorphic-input.component';
import { CHILL_PROPERTY_TYPE, type ChillMetadataRecord, type ChillPropertySchema, type ChillSchema } from '../models/chill-schema.models';
import type { ChillMenuItem } from '../models/chill-menu.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceService } from '../services/workspace.service';
import type { WorkspaceTaskComponent } from '../models/workspace-task.models';

type MenuFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

interface MenuItemDialogResult {
  value: ChillMenuItem;
}

@Component({
  selector: 'app-workspace-menu-item-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ChillPolymorphicInputComponent],
  template: `
    <section class="menu-item-dialog">
      <p class="menu-item-dialog__lede">
        {{ parentTitle()
          ? chill.T('E603B25F-2943-4FE0-A4B0-11A0D8884D38', 'Configure the selected child menu item.', 'Configura la voce di menu figlia selezionata.')
          : chill.T('E7E1166A-D146-49C6-BE63-8C514B2D6097', 'Configure the selected root menu item.', 'Configura la voce di menu radice selezionata.') }}
      </p>

      @if (parentTitle()) {
        <p class="menu-item-dialog__parent">
          {{ chill.T('35D75951-2BAA-4DEB-959A-9ED9D75BE4C8', 'Parent', 'Padre') }}: <strong>{{ parentTitle() }}</strong>
        </p>
      }

      <app-chill-polymorphic-input
        [form]="form"
        [schema]="schema()"
        [showLabels]="true"
        (validityChange)="isValid.set($event)"></app-chill-polymorphic-input>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .menu-item-dialog {
      display: grid;
      gap: 1rem;
    }

    .menu-item-dialog__lede,
    .menu-item-dialog__parent {
      margin: 0;
      color: var(--text-muted);
    }

    .menu-item-dialog__parent strong {
      color: var(--text-main);
    }
  `
})
export class WorkspaceMenuItemDialogComponent implements WorkspaceTaskComponent<MenuItemDialogResult> {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);

  readonly item = input<ChillMenuItem | null>(null);
  readonly parent = input<ChillMenuItem | null>(null);

  readonly isValid = signal(true);
  readonly componentOptions = computed<[string, string][]>(() => {
    const registryOptions = this.workspace.availableTasks()
      .map((task) => [task.componentName, `${task.title} (${task.componentName})`] as [string, string])
      .sort((left, right) => left[1].localeCompare(right[1]));

    return [
      ['', 'Menu empty node'],
      ...registryOptions
    ];
  });
  readonly properties = computed<ChillPropertySchema[]>(() => [
    {
      name: 'title',
      displayName: 'Title',
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: false,
      metadata: { required: 'true', maxLength: '255' } as ChillMetadataRecord
    },
    {
      name: 'description',
      displayName: 'Description',
      propertyType: CHILL_PROPERTY_TYPE.Text,
      isNullable: true,
      metadata: {} as ChillMetadataRecord
    },
    {
      name: 'componentName',
      displayName: 'ComponentName',
      propertyType: CHILL_PROPERTY_TYPE.Select,
      isNullable: true,
      metadata: {
        required: 'false',
        options: this.componentOptions()
      } as ChillMetadataRecord
    },
    {
      name: 'componentConfigurationJson',
      displayName: 'ComponentConfigurationJson',
      propertyType: CHILL_PROPERTY_TYPE.Json,
      isNullable: true,
      metadata: {} as ChillMetadataRecord
    },
    {
      name: 'menuHierarchy',
      displayName: 'MenuHierarchy',
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      metadata: { required: 'false', maxLength: '255' } as ChillMetadataRecord
    }
  ]);
  readonly schema = computed<ChillSchema>(() => ({
    chillType: 'Workspace.MenuItem',
    chillViewCode: 'dialog',
    displayName: this.chill.T('A92F5438-A4FB-4FC4-BA51-308D38208E77', 'Menu item', 'Voce di menu'),
    metadata: {},
    properties: this.properties()
  }));

  readonly form: MenuFormGroup = new FormGroup<Record<string, FormControl<JsonValue>>>({
    title: new FormControl<JsonValue>('', { nonNullable: true }),
    description: new FormControl<JsonValue>('', { nonNullable: true }),
    componentName: new FormControl<JsonValue>('', { nonNullable: true }),
    componentConfigurationJson: new FormControl<JsonValue>('', { nonNullable: true }),
    menuHierarchy: new FormControl<JsonValue>('', { nonNullable: true })
  });

  constructor() {
    effect(() => {
      const source = this.item();
      this.form.controls['title'].setValue(source?.title ?? '');
      this.form.controls['description'].setValue(source?.description ?? '');
      this.form.controls['componentName'].setValue(source?.componentName ?? '');
      this.form.controls['componentConfigurationJson'].setValue(source?.componentConfigurationJson ?? '');
      this.form.controls['menuHierarchy'].setValue(source?.menuHierarchy ?? '');
    });
  }

  canDialogSubmit(): boolean {
    return this.isValid();
  }

  dialogResult(): MenuItemDialogResult {
    const source = this.item();
    const parent = this.parent();
    return {
      value: {
        guid: source?.guid ?? '',
        positionNo: source?.positionNo ?? 0,
        title: this.readString('title'),
        description: this.readOptionalString('description'),
        parent,
        componentName: this.readString('componentName'),
        componentConfigurationJson: this.readOptionalString('componentConfigurationJson'),
        menuHierarchy: this.readString('menuHierarchy')
      }
    };
  }

  parentTitle(): string {
    return this.parent()?.title?.trim() ?? '';
  }

  private readString(controlName: string): string {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' ? value.trim() : '';
  }

  private readOptionalString(controlName: string): string | null {
    const value = this.readString(controlName);
    return value ? value : null;
  }
}
