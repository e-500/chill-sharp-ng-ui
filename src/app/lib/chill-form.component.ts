import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type {
  ChillEntity,
  ChillFormSubmitEvent,
  ChillPropertySchema,
  ChillQuery,
  ChillSchema
} from '../models/chill-schema.models';
import { ChillPolymorphicInputComponent } from './chill-polymorphic-input.component';
import { ChillService } from '../services/chill.service';

const FORM_LAYOUT_METADATA_KEY = 'chill-form-component';
const DEFAULT_FORM_COLUMN_COUNT = 2;
const EMPTY_LAYOUT_ITEM_PREFIX = '__empty__';

interface FormLayoutItem {
  id: string;
  kind: 'property' | 'empty';
  name?: string;
  span: number;
}

interface FormLayoutState {
  columnCount: number;
  items: FormLayoutItem[];
}

type ResolvedFormLayoutItem =
  | { id: string; kind: 'property'; property: ChillPropertySchema; span: number }
  | { id: string; kind: 'empty'; span: number };

@Component({
  selector: 'app-chill-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillPolymorphicInputComponent],
  templateUrl: './chill-form.component.html',
  styleUrl: './chill-form.component.scss'   
})
export class ChillFormComponent {
  readonly chill = inject(ChillService);
  readonly schema = input<ChillSchema | null>(null);
  readonly entity = input<ChillEntity | null>(null);
  readonly query = input<ChillQuery | null>(null);
  readonly submitLabel = input(this.chill.T('22282CD9-6B51-4B50-87BE-36E3790D4B8D', 'Submit', 'Invia'));

  readonly formSubmit = output<ChillFormSubmitEvent>();

  readonly fields = signal<Record<string, JsonValue>>({});
  readonly propertyValidity = signal<Record<string, boolean>>({});
  readonly isEditMode = signal(false);
  readonly isSavingLayout = signal(false);
  readonly layoutError = signal('');
  readonly dragPropertyName = signal('');
  readonly layoutState = signal<FormLayoutState>({
    columnCount: DEFAULT_FORM_COLUMN_COUNT,
    items: []
  });
  readonly mode = computed<'entity' | 'query'>(() => this.query() ? 'query' : 'entity');
  readonly source = computed<ChillEntity | ChillQuery | null>(() => this.query() ?? this.entity());
  readonly properties = computed(() => this.schema()?.properties ?? []);
  readonly layoutItems = computed<ResolvedFormLayoutItem[]>(() => {
    const propertyMap = new Map(this.properties().map((property) => [property.name, property]));
    const layout = this.layoutState();
    const resolvedItems = layout.items
      .map((item) => {
        const span = Math.min(Math.max(item.span, 1), layout.columnCount);
        if (item.kind === 'empty') {
          return {
            id: item.id,
            kind: 'empty' as const,
            span
          };
        }

        const propertyName = item.name?.trim() ?? '';
        const property = propertyMap.get(propertyName);
        if (!property) {
          return null;
        }

        return {
          id: item.id,
          kind: 'property' as const,
          property,
          span
        };
      })
      .filter((item): item is ResolvedFormLayoutItem => item !== null);

    const knownPropertyNames = new Set(
      resolvedItems
        .filter((item): item is Extract<ResolvedFormLayoutItem, { kind: 'property' }> => item.kind === 'property')
        .map((item) => item.property.name)
    );

    const missingProperties = this.properties()
      .filter((property) => !knownPropertyNames.has(property.name))
      .map((property) => ({
        id: property.name,
        kind: 'property' as const,
        property,
        span: 1
      }));

    return [...resolvedItems, ...missingProperties];
  });
  readonly workingSource = computed<ChillEntity | ChillQuery | null>(() => {
    const source = this.source();
    const mergedProperties = {
      ...this.readSourceProperties(source),
      ...this.fields()
    };

    if (!source) {
      return {
        properties: mergedProperties
      } as ChillEntity;
    }

    return {
      ...source,
      properties: mergedProperties
    };
  });
  readonly canSubmit = computed(() => {
    if (this.isEditMode()) {
      return false;
    }

    return this.layoutItems()
      .filter((item): item is Extract<ResolvedFormLayoutItem, { kind: 'property' }> => item.kind === 'property')
      .every((item) => this.propertyValidity()[item.property.name] !== false);
  });

  constructor() {
    effect(() => {
      const schema = this.schema();
      this.query();
      this.entity();
      this.fields.set({});
      this.propertyValidity.set({});
      this.layoutState.set(this.readLayoutState(schema));
      this.layoutError.set('');
      this.isEditMode.set(false);
    });
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }

    const payload = this.mode() === 'query'
      ? this.buildQueryPayload()
      : this.buildEntityPayload();

    this.formSubmit.emit({
      kind: this.mode(),
      value: payload
    });
  }

  toggleEditMode(): void {
    if (!this.isEditMode()) {
      this.isEditMode.set(true);
      this.layoutError.set('');
      return;
    }

    this.saveLayout();
  }

  updateFields(value: Record<string, JsonValue>): void {
    this.fields.update((current) => {
      const next = {
        ...current,
        ...value
      };

      return this.areRecordsEqual(current, next)
        ? current
        : next;
    });
  }

  updatePropertyValidity(propertyName: string, isValid: boolean): void {
    this.propertyValidity.update((current) => {
      if (current[propertyName] === isValid) {
        return current;
      }

      return {
        ...current,
        [propertyName]: isValid
      };
    });
  }

  updateColumnCount(value: number | string): void {
    const parsedValue = typeof value === 'number' ? value : Number(value);
    const columnCount = Number.isFinite(parsedValue)
      ? Math.max(1, Math.floor(parsedValue))
      : DEFAULT_FORM_COLUMN_COUNT;

    this.layoutState.update((current) => ({
      columnCount,
      items: current.items.map((item) => ({
        ...item,
        span: Math.min(item.span, columnCount)
      }))
    }));
  }

  addEmptyCell(): void {
    this.layoutState.update((current) => ({
      ...current,
      items: [
        ...current.items,
        {
          id: this.createEmptyLayoutItemId(current.items),
          kind: 'empty',
          span: 1
        }
      ]
    }));
  }

  increaseSpan(itemId: string): void {
    this.layoutState.update((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId
        ? { ...item, span: Math.min(item.span + 1, current.columnCount) }
        : item)
    }));
  }

  decreaseSpan(itemId: string): void {
    this.layoutState.update((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId
        ? { ...item, span: Math.max(1, item.span - 1) }
        : item)
    }));
  }

  resetLayout(): void {
    this.layoutState.update((current) => ({
      columnCount: current.columnCount,
      items: (this.schema()?.properties ?? []).map((property) => ({
        id: property.name,
        kind: 'property' as const,
        name: property.name,
        span: 1
      }))
    }));
  }

  beginDrag(itemId: string): void {
    if (!this.isEditMode()) {
      return;
    }

    this.dragPropertyName.set(itemId);
  }

  allowDrop(event: DragEvent): void {
    if (!this.isEditMode()) {
      return;
    }

    event.preventDefault();
  }

  dropProperty(targetItemId: string): void {
    const sourceItemId = this.dragPropertyName();
    if (!sourceItemId || sourceItemId === targetItemId) {
      this.dragPropertyName.set('');
      return;
    }

    this.layoutState.update((current) => {
      const nextItems = [...current.items];
      const sourceIndex = nextItems.findIndex((item) => item.id === sourceItemId);
      const targetIndex = nextItems.findIndex((item) => item.id === targetItemId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const [movedItem] = nextItems.splice(sourceIndex, 1);
      const insertionIndex = sourceIndex < targetIndex
        ? targetIndex - 1
        : targetIndex;
      nextItems.splice(insertionIndex, 0, movedItem);

      return {
        ...current,
        items: nextItems
      };
    });

    this.dragPropertyName.set('');
  }

  endDrag(): void {
    this.dragPropertyName.set('');
  }

  gridTemplateColumns(): string {
    return `repeat(${this.layoutState().columnCount}, minmax(0, 1fr))`;
  }

  trackByProperty(index: number, item: ResolvedFormLayoutItem): string {
    return item.id || `${index}`;
  }

  private buildEntityPayload(): ChillEntity {
    const entity = this.entity();
    return {
      ...(entity ?? {}),
      properties: this.buildPropertiesObject()
    };
  }

  private buildQueryPayload(): ChillQuery {
    const query = this.query();
    return {
      ...(query ?? {}),
      properties: this.buildPropertiesObject()
    };
  }

  private buildPropertiesObject(): Record<string, JsonValue> {
    const properties: Record<string, JsonValue> = {};
    const schema = this.schema();

    for (const property of this.properties()) {
      const rawValue = this.fields()[property.name];
      properties[property.name] = this.chill.toJsonValue(schema, property.name, rawValue);
    }

    return properties;
  }

  private saveLayout(): void {
    const schema = this.schema();
    if (!schema) {
      this.isEditMode.set(false);
      return;
    }

    const metadata = this.readSchemaMetadata(schema);
    metadata[FORM_LAYOUT_METADATA_KEY] = JSON.stringify(this.layoutState());

    const updatedSchema: ChillSchema = {
      ...schema,
      metadata
    };

    this.isSavingLayout.set(true);
    this.layoutError.set('');

    this.chill.setSchema(updatedSchema).subscribe({
      next: (savedSchema) => {
        const effectiveSchema = savedSchema ?? updatedSchema;
        const targetSchema = this.schema();
        if (targetSchema) {
          targetSchema.metadata = this.readSchemaMetadata(effectiveSchema);
          (targetSchema as unknown as JsonObject)['Metadata'] = targetSchema.metadata as unknown as JsonValue;
        }
        this.layoutState.set(this.readLayoutState(effectiveSchema));
        this.isSavingLayout.set(false);
        this.isEditMode.set(false);
      },
      error: (error: unknown) => {
        this.layoutError.set(this.chill.formatError(error));
        this.isSavingLayout.set(false);
      }
    });
  }

  private createDefaultLayout(schema: ChillSchema | null): FormLayoutState {
    return {
      columnCount: DEFAULT_FORM_COLUMN_COUNT,
      items: (schema?.properties ?? []).map((property) => ({
        id: property.name,
        kind: 'property' as const,
        name: property.name,
        span: 1
      }))
    };
  }

  private readLayoutState(schema: ChillSchema | null): FormLayoutState {
    const defaultLayout = this.createDefaultLayout(schema);
    const metadata = this.readSchemaMetadata(schema);
    const rawLayout = metadata[FORM_LAYOUT_METADATA_KEY]?.trim();
    if (!rawLayout) {
      return defaultLayout;
    }

    try {
      const parsedLayout = JSON.parse(rawLayout) as Partial<FormLayoutState>;
      const columnCount = typeof parsedLayout.columnCount === 'number' && Number.isFinite(parsedLayout.columnCount)
        ? Math.max(1, Math.floor(parsedLayout.columnCount))
        : defaultLayout.columnCount;
      const rawItems = Array.isArray(parsedLayout.items)
        ? parsedLayout.items
        : (Array.isArray((parsedLayout as { properties?: unknown[] }).properties)
            ? (parsedLayout as { properties: unknown[] }).properties
            : []);
      const savedItems = rawItems
        .map((item, index) => this.normalizePersistedLayoutItem(item, index))
        .filter((item): item is FormLayoutItem => item !== null);
      const defaultPropertyNames = new Set(defaultLayout.items.flatMap((item) => item.kind === 'property' && item.name ? [item.name] : []));
      const orderedPropertyNames = [
        ...savedItems
          .flatMap((item) => item.kind === 'property' && item.name && defaultPropertyNames.has(item.name) ? [item.name] : []),
        ...defaultLayout.items
          .flatMap((item) => item.kind === 'property' && item.name ? [item.name] : [])
          .filter((name) => !savedItems.some((item) => item.kind === 'property' && item.name === name))
      ];

      const restoredItems = savedItems
        .filter((item) => item.kind === 'empty' || (item.kind === 'property' && item.name && defaultPropertyNames.has(item.name)))
        .map((item) => ({
          ...item,
          span: Math.min(item.span, columnCount)
        }));

      const missingItems = orderedPropertyNames
        .filter((name) => !restoredItems.some((item) => item.kind === 'property' && item.name === name))
        .map((name) => ({
          id: name,
          kind: 'property' as const,
          name,
          span: 1
        }));

      return {
        columnCount,
        items: [...restoredItems, ...missingItems]
      };
    } catch {
      return defaultLayout;
    }
  }

  private normalizePersistedLayoutItem(value: unknown, index: number): FormLayoutItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = value as { id?: unknown; kind?: unknown; name?: unknown; span?: unknown };
    const span = typeof candidate.span === 'number' && Number.isFinite(candidate.span)
      ? Math.max(1, Math.floor(candidate.span))
      : 1;

    const kind = candidate.kind === 'empty'
      ? 'empty'
      : 'property';

    if (kind === 'empty') {
      const id = typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : `${EMPTY_LAYOUT_ITEM_PREFIX}${index + 1}`;
      return {
        id,
        kind,
        span
      };
    }

    const name = typeof candidate.name === 'string'
      ? candidate.name.trim()
      : '';
    if (!name) {
      return null;
    }

    return {
      id: typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : name,
      kind,
      name,
      span
    };
  }

  private createEmptyLayoutItemId(items: FormLayoutItem[]): string {
    let index = 1;
    while (items.some((item) => item.id === `${EMPTY_LAYOUT_ITEM_PREFIX}${index}`)) {
      index += 1;
    }

    return `${EMPTY_LAYOUT_ITEM_PREFIX}${index}`;
  }

  private readSchemaMetadata(schema: ChillSchema | null): Record<string, string> {
    if (!schema) {
      return {};
    }

    const camelMetadata = schema.metadata;
    if (camelMetadata) {
      return { ...camelMetadata };
    }

    const pascalMetadata = (schema as unknown as JsonObject)['Metadata'];
    if (pascalMetadata && typeof pascalMetadata === 'object' && !Array.isArray(pascalMetadata)) {
      return Object.fromEntries(
        Object.entries(pascalMetadata).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])
      );
    }

    return {};
  }

  private readSourceProperties(source: ChillEntity | ChillQuery | null): Record<string, JsonValue> {
    if (!source) {
      return {};
    }

    const lowerCaseProperties = source.properties;
    if (lowerCaseProperties) {
      return { ...lowerCaseProperties };
    }

    const pascalCaseProperties = source['Properties'];
    if (pascalCaseProperties && typeof pascalCaseProperties === 'object' && !Array.isArray(pascalCaseProperties)) {
      return Object.fromEntries(Object.entries(pascalCaseProperties)) as Record<string, JsonValue>;
    }

    return {};
  }

  private areRecordsEqual(
    left: Record<string, JsonValue>,
    right: Record<string, JsonValue>
  ): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => Object.is(left[key], right[key]));
  }
}
