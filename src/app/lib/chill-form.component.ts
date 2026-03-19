import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { JsonValue } from 'chill-sharp-ng-client';
import type {
  ChillEntity,
  ChillFormSubmitEvent,
  ChillPropertySchema,
  ChillQuery,
  ChillSchema
} from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';

type FieldValueMap = Record<string, string | boolean>;

@Component({
  selector: 'app-chill-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  readonly fields = signal<FieldValueMap>({});
  readonly columns = computed(() => this.schema()?.properties ?? []);
  readonly mode = computed<'entity' | 'query'>(() => this.query() ? 'query' : 'entity');

  constructor() {
    effect(() => {
      const schema = this.schema();
      const source = this.query() ?? this.entity();
      this.fields.set(this.createFieldState(schema, source));
    });
  }

  submit(): void {
    const payload = this.mode() === 'query'
      ? this.buildQueryPayload()
      : this.buildEntityPayload();

    this.formSubmit.emit({
      kind: this.mode(),
      value: payload
    });
  }

  fieldType(property: ChillPropertySchema): 'text' | 'number' | 'checkbox' | 'date' {
    const currentValue = this.fields()[property.name];
    if (typeof currentValue === 'boolean') {
      return 'checkbox';
    }

    const metadataType = property.metadata?.['inputType']?.toLowerCase();
    if (metadataType === 'checkbox') {
      return 'checkbox';
    }
    if (metadataType === 'number') {
      return 'number';
    }
    if (metadataType === 'date') {
      return 'date';
    }

    if (property.dateFormat?.trim()) {
      return 'date';
    }

    if (typeof currentValue === 'string' && currentValue.trim() && !Number.isNaN(Number(currentValue))) {
      return 'number';
    }

    return 'text';
  }

  isMultiline(property: ChillPropertySchema): boolean {
    return property.metadata?.['multiline'] === 'true'
      || property.customFormat?.toLowerCase() === 'textarea';
  }

  updateTextField(propertyName: string, value: string): void {
    this.fields.update((current) => ({
      ...current,
      [propertyName]: value
    }));
  }

  updateBooleanField(propertyName: string, value: boolean): void {
    this.fields.update((current) => ({
      ...current,
      [propertyName]: value
    }));
  }

  private createFieldState(schema: ChillSchema | null, source: ChillEntity | ChillQuery | null): FieldValueMap {
    const properties = schema?.properties ?? [];
    const nextState: FieldValueMap = {};

    for (const property of properties) {
      const rawValue = this.readPropertyValue(source, property.name);
      nextState[property.name] = this.normalizeFieldValue(rawValue);
    }

    return nextState;
  }

  private normalizeFieldValue(value: JsonValue | undefined): string | boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    if (value === null || value === undefined) {
      return '';
    }

    return '';
  }

  private readPropertyValue(source: ChillEntity | ChillQuery | null, propertyName: string): JsonValue | undefined {
    if (!source) {
      return undefined;
    }

    const properties = source.properties;
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    return source[propertyName];
  }

  private buildEntityPayload(): ChillEntity {
    const entity = this.entity();
    return {
      ...(entity ?? {}),
      Properties: this.buildPropertiesObject()
    };
  }

  private buildQueryPayload(): ChillQuery {
    const query = this.query();
    return {
      ...(query ?? {}),
      Properties: this.buildPropertiesObject()
    };
  }

  private buildPropertiesObject(): Record<string, JsonValue> {
    const properties: Record<string, JsonValue> = {};

    for (const property of this.columns()) {
      const rawValue = this.fields()[property.name];
      properties[property.name] = this.toJsonValue(rawValue, property);
    }

    return properties;
  }

  private toJsonValue(value: string | boolean | undefined, property: ChillPropertySchema): JsonValue {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = value?.trim() ?? '';
    if (!normalized) {
      return '';
    }

    if (this.fieldType(property) === 'number' && !Number.isNaN(Number(normalized))) {
      return Number(normalized);
    }

    return normalized;
  }
}
