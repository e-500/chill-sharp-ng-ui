import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { JsonValue } from 'chill-sharp-ng-client';
import { Subscription, firstValueFrom } from 'rxjs';
import { ChillPolymorphicInputComponent } from '../lib/chill-polymorphic-input.component';
import {
  CHILL_PROPERTY_TYPE,
  type ChillMetadataRecord,
  type ChillPropertySchema,
  type ChillSchema,
  type ChillSchemaRelation,
  type ChillSchemaRelationLabel
} from '../models/chill-schema.models';
import type { ChillMenuItem } from '../models/chill-menu.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceService } from '../services/workspace.service';
import type { WorkspaceTaskComponent } from '../models/workspace-task.models';
import { WorkspaceToolbarService } from '../services/workspace-toolbar.service';

type MenuFormGroup = FormGroup<Record<string, FormControl<JsonValue>>>;

interface MenuItemDialogResult {
  value: ChillMenuItem;
}

const CRUD_CONFIGURATION_KEYS = new Set([
  'chillType',
  'chillQuery',
  'viewCode',
  'disableAdd',
  'disableCreate',
  'disableEdit',
  'disableInlineEdit',
  'disableDelete',
  'relationLabel',
  'defaultValues',
  'fixedValues',
  'fixedQueryValues',
  'defaultQueryValues',
  'relations'
]);

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
export class WorkspaceMenuItemDialogComponent implements WorkspaceTaskComponent<MenuItemDialogResult>, OnDestroy {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly toolbar = inject(WorkspaceToolbarService);

  readonly item = input<ChillMenuItem | null>(null);
  readonly parent = input<ChillMenuItem | null>(null);
  readonly visible = input(true);

  readonly isValid = signal(true);
  readonly isGeneratingConfigurationExample = signal(false);
  readonly selectedComponentName = signal('');
  readonly componentOptions = computed<[string, string][]>(() => {
    const registryOptions = this.workspace.availableTasks()
      .map((task) => [task.componentName, `${task.title} (${task.componentName})`] as [string, string])
      .sort((left, right) => left[1].localeCompare(right[1]));

    return [
      ['', 'Menu empty node'],
      ...registryOptions
    ];
  });
  readonly selectedTaskDefinition = computed(() => {
    const componentName = this.selectedComponentName().toLowerCase();
    if (!componentName) {
      return null;
    }

    return this.workspace.availableTasks().find((task) => task.componentName === componentName) ?? null;
  });
  readonly selectedComponentConfigurationJsonExample = computed(() =>
    this.selectedTaskDefinition()?.componentConfigurationJsonExample?.trim() || '{}'
  );
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
  private readonly componentNameSubscription: Subscription;

  constructor() {
    this.componentNameSubscription = this.form.controls['componentName'].valueChanges.subscribe((value) => {
      this.selectedComponentName.set(typeof value === 'string' ? value.trim() : '');
    });

    effect(() => {
      const source = this.item();
      this.form.controls['title'].setValue(source?.title ?? '');
      this.form.controls['description'].setValue(source?.description ?? '');
      this.form.controls['componentName'].setValue(source?.componentName ?? '');
      this.selectedComponentName.set(source?.componentName?.trim() ?? '');
      this.form.controls['componentConfigurationJson'].setValue(source?.componentConfigurationJson ?? '');
      this.form.controls['menuHierarchy'].setValue(source?.menuHierarchy ?? '');
    });

    effect(() => {
      const selectedTask = this.selectedTaskDefinition();
      this.toolbar.setButtons([
        {
          id: 'menu-item-apply-configuration-example',
          labelGuid: '64BFBDFC-EA1B-47C5-95E1-8B5074B9E98A',
          primaryDefaultText: 'Use config example',
          secondaryDefaultText: 'Usa esempio config',
          ariaLabel: this.chill.T(
            '64BFBDFC-EA1B-47C5-95E1-8B5074B9E98A',
            'Use config example',
            'Usa esempio config'
          ),
          icon: 'data_object',
          iconClass: 'material-symbol-icon',
          action: () => void this.applyComponentConfigurationJsonExample(),
          disabled: !selectedTask || this.isGeneratingConfigurationExample()
        }
      ], 'dialog');
    });
  }

  ngOnDestroy(): void {
    this.componentNameSubscription.unsubscribe();
    this.toolbar.clearButtons('dialog');
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

  async applyComponentConfigurationJsonExample(): Promise<void> {
    const selectedTask = this.selectedTaskDefinition();
    if (!selectedTask) {
      return;
    }

    this.isGeneratingConfigurationExample.set(true);
    try {
      const nextValue = this.selectedComponentName().trim().toLowerCase() === 'crud'
        ? await this.generateCrudComponentConfigurationJsonExample()
        : this.selectedComponentConfigurationJsonExample();
      this.form.controls['componentConfigurationJson'].setValue(nextValue);
    } catch {
      this.form.controls['componentConfigurationJson'].setValue(
        this.readString('componentConfigurationJson') || this.selectedComponentConfigurationJsonExample()
      );
    } finally {
      this.isGeneratingConfigurationExample.set(false);
    }

    this.form.controls['componentConfigurationJson'].markAsDirty();
    this.form.controls['componentConfigurationJson'].markAsTouched();
  }

  private readString(controlName: string): string {
    const value = this.form.controls[controlName].value;
    return typeof value === 'string' ? value.trim() : '';
  }
  private readOptionalString(controlName: string): string | null {
    const value = this.readString(controlName);
    return value ? value : null;
  }

  private async generateCrudComponentConfigurationJsonExample(): Promise<string> {
    const currentConfiguration = this.parseConfigurationJson(
      this.readString('componentConfigurationJson')
    ) ?? this.parseConfigurationJson(this.selectedComponentConfigurationJsonExample());

    if (!currentConfiguration) {
      return this.selectedComponentConfigurationJsonExample();
    }

    const templateConfiguration = this.parseConfigurationJson(this.selectedComponentConfigurationJsonExample())
      ?? this.createEmptyCrudConfiguration();
    const seedConfiguration = this.composeCrudConfigurationSeed(templateConfiguration, currentConfiguration);
    const chillType = this.readConfigurationString(seedConfiguration, 'chillType');
    if (!chillType) {
      return JSON.stringify(seedConfiguration, null, 2);
    }

    const viewCode = this.readConfigurationString(seedConfiguration, 'viewCode') || 'default';
    const nextConfiguration = await this.buildCrudConfigurationFromSchema(
      seedConfiguration,
      chillType,
      viewCode,
      new Set<string>()
    );

    return JSON.stringify(nextConfiguration, null, 2);
  }

  private async buildCrudConfigurationFromSchema(
    seedConfiguration: Record<string, unknown>,
    chillType: string,
    viewCode: string,
    visited: Set<string>
  ): Promise<Record<string, unknown>> {
    const normalizedChillType = chillType.trim();
    const normalizedViewCode = viewCode.trim() || 'default';
    const visitKey = `${normalizedChillType.toLowerCase()}|${normalizedViewCode.toLowerCase()}`;
    if (visited.has(visitKey)) {
      return this.createCrudConfigurationObject(seedConfiguration, []);
    }

    const nextVisited = new Set(visited);
    nextVisited.add(visitKey);

    const schema = await firstValueFrom(this.chill.getSchema(normalizedChillType, normalizedViewCode, undefined, true));
    const relationConfigurations = await Promise.all((schema?.relations ?? []).map((relation) =>
      this.buildCrudRelationConfiguration(relation, normalizedViewCode, nextVisited)
    ));

    return this.createCrudConfigurationObject(
      seedConfiguration,
      relationConfigurations.filter((configuration): configuration is Record<string, unknown> => configuration !== null)
    );
  }

  private async buildCrudRelationConfiguration(
    relation: ChillSchemaRelation,
    viewCode: string,
    visited: Set<string>
  ): Promise<Record<string, unknown> | null> {
    const chillType = this.normalizeString(relation.chillType);
    if (!chillType) {
      return null;
    }

    const seedConfiguration = this.createCrudConfigurationObject({
      chillType,
      chillQuery: this.normalizeString(relation.chillQuery) || null,
      viewCode,
      relationLabel: this.mapRelationLabel(relation.relationLabel) ?? this.createEmptyRelationLabel(),
      fixedValues: this.normalizeJsonRecord(relation.fixedValues),
      fixedQueryValues: this.normalizeJsonRecord(relation.fixedQueryValues)
    }, []);

    try {
      return await this.buildCrudConfigurationFromSchema(seedConfiguration, chillType, viewCode, visited);
    } catch {
      return seedConfiguration;
    }
  }

  private composeCrudConfigurationSeed(
    templateConfiguration: Record<string, unknown>,
    currentConfiguration: Record<string, unknown>
  ): Record<string, unknown> {
    const chillType = this.readConfigurationString(currentConfiguration, 'chillType')
      || this.readConfigurationString(templateConfiguration, 'chillType');
    const chillQuery = this.readConfigurationString(currentConfiguration, 'chillQuery')
      || this.readConfigurationString(templateConfiguration, 'chillQuery');
    const viewCode = this.readConfigurationString(currentConfiguration, 'viewCode')
      || this.readConfigurationString(templateConfiguration, 'viewCode')
      || 'default';

    return this.createCrudConfigurationObject({
      chillType,
      chillQuery: chillQuery || null,
      viewCode,
      disableAdd: this.readConfigurationBoolean(
        currentConfiguration,
        'disableAdd',
        this.readConfigurationBoolean(templateConfiguration, 'disableAdd', false)
      ),
      disableCreate: this.readConfigurationBoolean(
        currentConfiguration,
        'disableCreate',
        this.readConfigurationBoolean(templateConfiguration, 'disableCreate', false)
      ),
      disableEdit: this.readConfigurationBoolean(
        currentConfiguration,
        'disableEdit',
        this.readConfigurationBoolean(templateConfiguration, 'disableEdit', false)
      ),
      disableInlineEdit: this.readConfigurationBoolean(
        currentConfiguration,
        'disableInlineEdit',
        this.readConfigurationBoolean(templateConfiguration, 'disableInlineEdit', false)
      ),
      disableDelete: this.readConfigurationBoolean(
        currentConfiguration,
        'disableDelete',
        this.readConfigurationBoolean(templateConfiguration, 'disableDelete', false)
      ),
      relationLabel: this.readRelationLabelValue(currentConfiguration, 'relationLabel')
        ?? this.readRelationLabelValue(templateConfiguration, 'relationLabel')
        ?? this.createEmptyRelationLabel(),
      defaultValues: this.readConfigurationRecord(currentConfiguration, 'defaultValues')
        ?? this.readConfigurationRecord(templateConfiguration, 'defaultValues')
        ?? {},
      fixedValues: this.readConfigurationRecord(currentConfiguration, 'fixedValues')
        ?? this.readConfigurationRecord(templateConfiguration, 'fixedValues')
        ?? {},
      fixedQueryValues: this.readConfigurationRecord(currentConfiguration, 'fixedQueryValues')
        ?? this.readConfigurationRecord(templateConfiguration, 'fixedQueryValues')
        ?? {},
      defaultQueryValues: this.readConfigurationRecord(currentConfiguration, 'defaultQueryValues')
        ?? this.readConfigurationRecord(templateConfiguration, 'defaultQueryValues')
        ?? {},
      ...this.readAdditionalConfigurationEntries(templateConfiguration),
      ...this.readAdditionalConfigurationEntries(currentConfiguration)
    }, []);
  }

  private createCrudConfigurationObject(
    configuration: Record<string, unknown>,
    relations: Record<string, unknown>[]
  ): Record<string, unknown> {
    const chillType = this.readConfigurationString(configuration, 'chillType');
    const chillQuery = this.readConfigurationString(configuration, 'chillQuery');
    const viewCode = this.readConfigurationString(configuration, 'viewCode') || 'default';

    return {
      chillType,
      chillQuery: chillQuery || null,
      viewCode,
      disableAdd: this.readConfigurationBoolean(configuration, 'disableAdd', false),
      disableCreate: this.readConfigurationBoolean(configuration, 'disableCreate', false),
      disableEdit: this.readConfigurationBoolean(configuration, 'disableEdit', false),
      disableInlineEdit: this.readConfigurationBoolean(configuration, 'disableInlineEdit', false),
      disableDelete: this.readConfigurationBoolean(configuration, 'disableDelete', false),
      relationLabel: this.readRelationLabelValue(configuration, 'relationLabel') ?? this.createEmptyRelationLabel(),
      defaultValues: this.readConfigurationRecord(configuration, 'defaultValues') ?? {},
      fixedValues: this.readConfigurationRecord(configuration, 'fixedValues') ?? {},
      fixedQueryValues: this.readConfigurationRecord(configuration, 'fixedQueryValues') ?? {},
      defaultQueryValues: this.readConfigurationRecord(configuration, 'defaultQueryValues') ?? {},
      relations,
      ...this.readAdditionalConfigurationEntries(configuration)
    };
  }

  private createEmptyCrudConfiguration(): Record<string, unknown> {
    return {
      chillType: '',
      chillQuery: null,
      viewCode: 'default',
      disableAdd: false,
      disableCreate: false,
      disableEdit: false,
      disableInlineEdit: false,
      disableDelete: false,
      relationLabel: this.createEmptyRelationLabel(),
      defaultValues: {},
      fixedValues: {},
      fixedQueryValues: {},
      defaultQueryValues: {},
      relations: []
    };
  }

  private createEmptyRelationLabel(): Record<string, string> {
    return {
      labelGuid: '',
      primaryDefaultText: '',
      secondaryDefaultText: ''
    };
  }

  private parseConfigurationJson(value: string): Record<string, unknown> | null {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return {};
    }

    try {
      const parsed = JSON.parse(normalizedValue);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private readConfigurationString(configuration: Record<string, unknown>, key: string): string {
    const value = this.readConfigurationValue(configuration, key);
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : '';
  }

  private readConfigurationBoolean(configuration: Record<string, unknown>, key: string, fallbackValue: boolean): boolean {
    const value = this.readConfigurationValue(configuration, key);
    return typeof value === 'boolean'
      ? value
      : fallbackValue;
  }

  private readConfigurationRecord(configuration: Record<string, unknown>, key: string): Record<string, JsonValue> | null {
    const value = this.readConfigurationValue(configuration, key);
    return this.normalizeJsonRecord(value);
  }

  private readRelationLabelValue(
    configuration: Record<string, unknown>,
    key: string
  ): string | Record<string, string> | null {
    const value = this.readConfigurationValue(configuration, key);
    if (typeof value === 'string') {
      const normalizedValue = value.trim();
      return normalizedValue ? normalizedValue : null;
    }

    return this.mapRelationLabel(value);
  }

  private readAdditionalConfigurationEntries(configuration: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(configuration)
        .filter(([key]) => !CRUD_CONFIGURATION_KEYS.has(key.toLowerCase()))
    );
  }

  private readConfigurationValue(configuration: Record<string, unknown>, key: string): unknown {
    const directValue = configuration[key];
    if (directValue !== undefined) {
      return directValue;
    }

    const matchedKey = Object.keys(configuration).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return matchedKey ? configuration[matchedKey] : undefined;
  }

  private mapRelationLabel(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const relationLabel = value as ChillSchemaRelationLabel;
    return {
      labelGuid: this.normalizeString(relationLabel.labelGuid),
      primaryDefaultText: this.normalizeString(relationLabel.primaryDefaultText),
      secondaryDefaultText: this.normalizeString(relationLabel.secondaryDefaultText)
    };
  }

  private normalizeJsonRecord(value: unknown): Record<string, JsonValue> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, JsonValue>)
        .map(([key, entryValue]) => [key.trim(), entryValue] as const)
        .filter(([key]) => key.length > 0)
    );
  }

  private normalizeString(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }
}
