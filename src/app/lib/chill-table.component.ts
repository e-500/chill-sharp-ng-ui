import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillEntity, ChillPropertySchema, ChillSchema } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';

const TABLE_LAYOUT_METADATA_KEY = 'chill-table-component';

interface ColumnLayoutState {
  name: string;
  displayName: string;
  hidden: boolean;
}

interface PersistedTableLayout {
  columns: ColumnLayoutState[];
}

type TableColumn = ChillPropertySchema & {
  hidden: boolean;
  displayName: string;
};

@Component({
  selector: 'app-chill-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chill-table.component.html',
  styleUrl: './chill-table.component.scss'
})
export class ChillTableComponent {
  readonly chill = inject(ChillService);
  readonly schema = input<ChillSchema | null>(null);
  readonly entities = input<ChillEntity[]>([]);
  readonly isEditLayoutMode = signal(false);
  readonly isSavingLayout = signal(false);
  readonly layoutError = signal('');
  readonly dragColumnName = signal('');
  readonly layoutState = signal<ColumnLayoutState[]>([]);

  readonly columns = computed<TableColumn[]>(() => {
    const schema = this.schema();
    const properties = schema?.properties ?? [];
    const propertyMap = new Map(properties.map((property) => [property.name, property]));
    const savedLayout = this.layoutState();
    const orderedNames = [
      ...savedLayout.map((item) => item.name).filter((name) => propertyMap.has(name)),
      ...properties.map((property) => property.name).filter((name) => !savedLayout.some((item) => item.name === name))
    ];

    return orderedNames
      .map((name) => {
        const property = propertyMap.get(name);
        if (!property) {
          return null;
        }

        const layout = savedLayout.find((item) => item.name === name);
        return {
          ...property,
          displayName: layout?.displayName?.trim() || property.displayName || property.name,
          hidden: layout?.hidden ?? false
        };
      })
      .filter((column): column is TableColumn => column !== null);
  });

  readonly visibleColumns = computed(() => this.isEditLayoutMode()
    ? this.columns()
    : this.columns().filter((column) => !column.hidden));

  constructor() {
    effect(() => {
      this.layoutState.set(this.readLayoutState(this.schema()));
      this.layoutError.set('');
      this.isEditLayoutMode.set(false);
    });
  }

  trackByEntity(index: number, entity: ChillEntity): string {
    return this.readEntityText(entity, 'guid')
      ?? this.readEntityText(entity, 'Guid')
      ?? this.readEntityText(entity, 'label')
      ?? this.readEntityText(entity, 'Label')
      ?? `${index}`;
  }

  toggleEditLayoutMode(): void {
    if (!this.isEditLayoutMode()) {
      this.isEditLayoutMode.set(true);
      this.layoutError.set('');
      return;
    }

    this.saveLayout();
  }

  updateColumnDisplayName(columnName: string, value: string): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, displayName: value }
      : item));
  }

  updateColumnHidden(columnName: string, hidden: boolean): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, hidden }
      : item));
  }

  beginDrag(columnName: string): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    this.dragColumnName.set(columnName);
  }

  allowDrop(event: DragEvent): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    event.preventDefault();
  }

  dropColumn(targetColumnName: string): void {
    const sourceColumnName = this.dragColumnName();
    if (!sourceColumnName || sourceColumnName === targetColumnName) {
      this.dragColumnName.set('');
      return;
    }

    this.layoutState.update((current) => {
      const next = [...current];
      const sourceIndex = next.findIndex((item) => item.name === sourceColumnName);
      const targetIndex = next.findIndex((item) => item.name === targetColumnName);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });

    this.dragColumnName.set('');
  }

  endDrag(): void {
    this.dragColumnName.set('');
  }

  cellText(entity: ChillEntity, column: TableColumn): string {
    const value = this.readPropertyValue(entity, column.name);
    return this.formatValue(value);
  }

  private saveLayout(): void {
    const schema = this.schema();
    if (!schema) {
      this.isEditLayoutMode.set(false);
      return;
    }

    const metadata = this.readSchemaMetadata(schema);
    metadata[TABLE_LAYOUT_METADATA_KEY] = JSON.stringify({
      columns: this.layoutState()
    } satisfies PersistedTableLayout);

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
          (targetSchema as unknown as JsonObject)['metadata'] = targetSchema.metadata as unknown as JsonValue;
        }
        this.layoutState.set(this.readLayoutState(effectiveSchema));
        this.isSavingLayout.set(false);
        this.isEditLayoutMode.set(false);
      },
      error: (error: unknown) => {
        this.layoutError.set(this.chill.formatError(error));
        this.isSavingLayout.set(false);
      }
    });
  }

  private readLayoutState(schema: ChillSchema | null): ColumnLayoutState[] {
    const properties = schema?.properties ?? [];
    const defaultLayout = properties.map((property) => ({
      name: property.name,
      displayName: property.displayName || property.name,
      hidden: false
    }));

    const metadata = this.readSchemaMetadata(schema);
    const rawLayout = metadata[TABLE_LAYOUT_METADATA_KEY]?.trim();
    if (!rawLayout) {
      return defaultLayout;
    }

    try {
      const parsedLayout = JSON.parse(rawLayout) as Partial<PersistedTableLayout>;
      const savedColumns = Array.isArray(parsedLayout.columns)
        ? parsedLayout.columns
            .filter((item): item is ColumnLayoutState => typeof item?.name === 'string')
            .map((item) => ({
              name: item.name.trim(),
              displayName: typeof item.displayName === 'string' ? item.displayName : '',
              hidden: item.hidden === true
            }))
            .filter((item) => item.name.length > 0)
        : [];

      return defaultLayout.map((column) => savedColumns.find((item) => item.name === column.name) ?? column)
        .sort((left, right) => {
          const leftIndex = savedColumns.findIndex((item) => item.name === left.name);
          const rightIndex = savedColumns.findIndex((item) => item.name === right.name);
          const resolvedLeftIndex = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER;
          const resolvedRightIndex = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER;
          return resolvedLeftIndex - resolvedRightIndex;
        });
    } catch {
      return defaultLayout;
    }
  }

  private readSchemaMetadata(schema: ChillSchema | null): Record<string, string> {
    if (!schema) {
      return {};
    }

    const camelMetadata = schema.metadata;
    if (camelMetadata) {
      return { ...camelMetadata };
    }

    const pascalMetadata = (schema as unknown as JsonObject)['metadata'];
    if (pascalMetadata && typeof pascalMetadata === 'object' && !Array.isArray(pascalMetadata)) {
      return Object.fromEntries(
        Object.entries(pascalMetadata).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])
      );
    }

    return {};
  }

  private readPropertyValue(entity: ChillEntity, propertyName: string): JsonValue | undefined {
    const properties = this.readEntityProperties(entity);
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    const directValue = entity[propertyName]
      ?? entity[this.toPascalCase(propertyName)];
    return directValue;
  }

  private formatValue(value: JsonValue | undefined): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      const rendered = value
        .map((item) => this.formatValue(item))
        .filter((item) => item.length > 0);

      return rendered.join(', ');
    }

    return this.formatObjectValue(value);
  }

  private formatObjectValue(value: JsonObject): string {
    const label = this.readObjectText(value, 'Label')
      ?? this.readObjectText(value, 'DisplayName')
      ?? this.readObjectText(value, 'Name')
      ?? this.readObjectText(value, 'Guid');

    if (label) {
      return label;
    }

    return '';
  }

  private readObjectText(value: JsonObject, key: string): string | null {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }

    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return String(candidate);
    }

    return null;
  }

  private readEntityProperties(entity: ChillEntity): Record<string, JsonValue> | null {
    const lowerCaseProperties = entity.properties;
    if (lowerCaseProperties) {
      return lowerCaseProperties;
    }

    const pascalCaseProperties = entity['Properties'];
    return this.isJsonObjectRecord(pascalCaseProperties)
      ? pascalCaseProperties
      : null;
  }

  private readEntityText(entity: ChillEntity, key: string): string | null {
    const value = entity[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  private isJsonObjectRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private toPascalCase(value: string): string {
    return value.length > 0
      ? `${value[0].toUpperCase()}${value.slice(1)}`
      : value;
  }
}
