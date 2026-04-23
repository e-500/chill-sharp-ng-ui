import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillService } from '../services/chill.service';
import { ChillJsonInputComponent } from './chill-json-input.component';
import { getDateFormatOptions } from './date-format-options';
import { CHILL_PROPERTY_TYPE, CHILL_PROPERTY_TYPE_OPTIONS, canChangeChillPropertyType, chillSimplePropertyType, type ChillMetadataRecord, type ChillPropertySchema, type ChillSchema } from '../models/chill-schema.models';

type SchemaPropertyDraft = {
  name: string;
  displayName: string;
  propertyType: number;
  isNullable: boolean;
  isReadOnly: boolean;
  minLength: string;
  maxLength: string;
  integerMinValue: string;
  integerMaxValue: string;
  decimalMinValue: string;
  decimalMaxValue: string;
  decimalPlaces: string;
  precision: string;
  scale: string;
  dateFormat: string;
  customFormat: string;
  regexPattern: string;
  enumValues: string;
  metadataJson: string;
};

const MANAGED_METADATA_KEYS = ['required', 'readonly', 'minLength', 'maxLength', 'pattern', 'min', 'max', 'options'] as const;

@Component({
  selector: 'app-schema-property-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillJsonInputComponent],
  templateUrl: './schema-property-dialog.component.html',
  styleUrl: './schema-property-dialog.component.scss'
})
export class SchemaPropertyDialogComponent {
  readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);

  readonly schema = input<ChillSchema | null>(null);
  readonly property = input<ChillPropertySchema | null>(null);

  readonly draft = signal<SchemaPropertyDraft>(this.createEmptyDraft());
  readonly dateFormatOptions = getDateFormatOptions();
  readonly schemaTypeLabel = computed(() => this.schema()?.displayName?.trim() || this.schema()?.chillType?.trim() || '');
  readonly metadataJsonInvalid = computed(() => !this.tryParseMetadata(this.draft().metadataJson).ok);
  readonly selectedPropertyType = computed(() => this.draft().propertyType);
  readonly showLengthSettings = computed(() => {
    const propertyType = this.selectedPropertyType();
    return propertyType === CHILL_PROPERTY_TYPE.String
      || propertyType === CHILL_PROPERTY_TYPE.Text
      || propertyType === CHILL_PROPERTY_TYPE.Json
      || propertyType === CHILL_PROPERTY_TYPE.Select;
  });
  readonly showRegexPattern = computed(() => {
    const propertyType = this.selectedPropertyType();
    return propertyType === CHILL_PROPERTY_TYPE.String
      || propertyType === CHILL_PROPERTY_TYPE.Text;
  });
  readonly showIntegerRange = computed(() => this.selectedPropertyType() === CHILL_PROPERTY_TYPE.Integer);
  readonly showDecimalSettings = computed(() => this.selectedPropertyType() === CHILL_PROPERTY_TYPE.Decimal);
  readonly showDateFormat = computed(() => {
    const propertyType = this.selectedPropertyType();
    return propertyType === CHILL_PROPERTY_TYPE.Date || propertyType === CHILL_PROPERTY_TYPE.DateTime;
  });
  readonly showCustomFormat = computed(() => {
    const propertyType = this.selectedPropertyType();
    return propertyType === CHILL_PROPERTY_TYPE.String
      || propertyType === CHILL_PROPERTY_TYPE.Text
      || propertyType === CHILL_PROPERTY_TYPE.Json
      || propertyType === CHILL_PROPERTY_TYPE.Date
      || propertyType === CHILL_PROPERTY_TYPE.Time
      || propertyType === CHILL_PROPERTY_TYPE.DateTime
      || propertyType === CHILL_PROPERTY_TYPE.Duration;
  });
  readonly showEnumValues = computed(() => this.selectedPropertyType() === CHILL_PROPERTY_TYPE.Select);
  readonly validationMessages = computed(() => this.validateDraft(this.draft()));

  readonly propertyTypeOptions = CHILL_PROPERTY_TYPE_OPTIONS;

  constructor() {
    effect(() => {
      const property = this.property();
      this.draft.set(property ? this.createDraft(property) : this.createEmptyDraft());
    });
  }

  canDialogSubmit(): boolean {
    return this.validationMessages().length === 0;
  }

  submit(): void {
    const source = this.property();
    if (!source || !this.canDialogSubmit()) {
      return;
    }

    this.dialog.confirm(this.buildProperty(source, this.draft()));
  }

  updateText<K extends keyof SchemaPropertyDraft>(key: K, value: SchemaPropertyDraft[K]): void {
    this.draft.update((current) => ({
      ...current,
      [key]: value
    }));
  }

  updateBoolean(key: 'isNullable' | 'isReadOnly', value: boolean): void {
    this.draft.update((current) => ({
      ...current,
      [key]: value === true
    }));
  }

  updatePropertyType(value: number | string): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    const property = this.property();
    if (!property || !Number.isFinite(parsed) || !canChangeChillPropertyType(property.propertyType, parsed)) {
      return;
    }

    this.draft.update((current) => ({
      ...current,
      propertyType: parsed
    }));
  }

  isPropertyTypeOptionDisabled(value: number): boolean {
    const property = this.property();
    return !!property && !canChangeChillPropertyType(property.propertyType, value);
  }

  enumValuesPlaceholder(): string {
    return this.chill.T(
      '563559B9-F9B4-4E7A-923A-086A517CDE8A',
      'One value per line. Use "value = label" to customize the shown text.',
      'Un valore per riga. Usa "valore = etichetta" per personalizzare il testo mostrato.'
    );
  }

  metadataPlaceholder(): string {
    return '{\n  \n}';
  }

  private createDraft(property: ChillPropertySchema): SchemaPropertyDraft {
    return {
      name: property.name ?? '',
      displayName: property.displayName ?? property.name ?? '',
      propertyType: property.propertyType ?? CHILL_PROPERTY_TYPE.Unknown,
      isNullable: property.isNullable !== false,
      isReadOnly: property.isReadOnly ?? this.readBooleanMetadata(property.metadata, 'readonly'),
      minLength: this.formatOptionalNumber(property.minLength ?? this.readMetadataNumber(property.metadata, 'minLength')),
      maxLength: this.formatOptionalNumber(property.maxLength ?? this.readMetadataNumber(property.metadata, 'maxLength')),
      integerMinValue: this.formatOptionalNumber(property.integerMinValue ?? this.readMetadataNumber(property.metadata, 'min')),
      integerMaxValue: this.formatOptionalNumber(property.integerMaxValue ?? this.readMetadataNumber(property.metadata, 'max')),
      decimalMinValue: this.formatOptionalNumber(property.decimalMinValue ?? this.readMetadataNumber(property.metadata, 'min')),
      decimalMaxValue: this.formatOptionalNumber(property.decimalMaxValue ?? this.readMetadataNumber(property.metadata, 'max')),
      decimalPlaces: this.formatOptionalNumber(property.decimalPlaces),
      precision: this.formatOptionalNumber(property.precision),
      scale: this.formatOptionalNumber(property.scale),
      dateFormat: property.dateFormat ?? '',
      customFormat: property.customFormat ?? '',
      regexPattern: property.regexPattern ?? this.readMetadataString(property.metadata, 'pattern'),
      enumValues: this.serializeEnumValues(property),
      metadataJson: this.stringifyMetadata(property.metadata)
    };
  }

  private createEmptyDraft(): SchemaPropertyDraft {
    return {
      name: '',
      displayName: '',
      propertyType: CHILL_PROPERTY_TYPE.String,
      isNullable: true,
      isReadOnly: false,
      minLength: '',
      maxLength: '',
      integerMinValue: '',
      integerMaxValue: '',
      decimalMinValue: '',
      decimalMaxValue: '',
      decimalPlaces: '',
      precision: '',
      scale: '',
      dateFormat: '',
      customFormat: '',
      regexPattern: '',
      enumValues: '',
      metadataJson: '{\n  \n}'
    };
  }

  private validateDraft(draft: SchemaPropertyDraft): string[] {
    const messages: string[] = [];
    if (!draft.name.trim()) {
      messages.push(this.chill.T('93531950-1BC3-470F-A460-84296F0E8569', 'Property name is required.', 'Il nome proprietà è obbligatorio.'));
    }

    if (!this.tryParseMetadata(draft.metadataJson).ok) {
      messages.push(this.chill.T('00B1B7D1-F59B-4D53-8D0A-C99D7D0A7180', 'Metadata must be a valid JSON object.', 'I metadata devono essere un oggetto JSON valido.'));
    }

    const minLength = this.parseOptionalInteger(draft.minLength);
    const maxLength = this.parseOptionalInteger(draft.maxLength);
    if (this.showLengthSettings()) {
      if (draft.minLength.trim() && minLength === null) {
        messages.push(this.chill.T('7A070C4A-8E91-4736-B7B6-65E58D4ED1F4', 'Min length must be an integer.', 'La lunghezza minima deve essere un intero.'));
      }
      if (draft.maxLength.trim() && maxLength === null) {
        messages.push(this.chill.T('4C6079A7-B5D8-4A05-B9D3-4349B4518D9A', 'Max length must be an integer.', 'La lunghezza massima deve essere un intero.'));
      }
      if (minLength !== null && maxLength !== null && minLength > maxLength) {
        messages.push(this.chill.T('E7502A18-FB9A-4E61-83BC-51E2D86CE83C', 'Min length cannot exceed max length.', 'La lunghezza minima non può superare la lunghezza massima.'));
      }
    }

    const integerMin = this.parseOptionalInteger(draft.integerMinValue);
    const integerMax = this.parseOptionalInteger(draft.integerMaxValue);
    if (this.showIntegerRange()) {
      if (draft.integerMinValue.trim() && integerMin === null) {
        messages.push(this.chill.T('389A718A-A7A3-4D91-8E93-0D7284F940B4', 'Integer min value must be an integer.', 'Il valore intero minimo deve essere un intero.'));
      }
      if (draft.integerMaxValue.trim() && integerMax === null) {
        messages.push(this.chill.T('68B76D88-8E84-4C49-A6AF-CBDBCB7A8892', 'Integer max value must be an integer.', 'Il valore intero massimo deve essere un intero.'));
      }
      if (integerMin !== null && integerMax !== null && integerMin > integerMax) {
        messages.push(this.chill.T('2A0B5BEA-E98A-43E1-8AE6-BF90105A10A1', 'Integer min value cannot exceed integer max value.', 'Il valore intero minimo non può superare il valore intero massimo.'));
      }
    }

    const decimalMin = this.parseOptionalDecimal(draft.decimalMinValue);
    const decimalMax = this.parseOptionalDecimal(draft.decimalMaxValue);
    if (this.showDecimalSettings()) {
      if (draft.decimalMinValue.trim() && decimalMin === null) {
        messages.push(this.chill.T('113D8E72-BF6E-489A-912C-7D19C85173CA', 'Decimal min value must be numeric.', 'Il valore decimale minimo deve essere numerico.'));
      }
      if (draft.decimalMaxValue.trim() && decimalMax === null) {
        messages.push(this.chill.T('74D8A6F0-B66C-4B06-BDE4-E64F210205F6', 'Decimal max value must be numeric.', 'Il valore decimale massimo deve essere numerico.'));
      }
      if (decimalMin !== null && decimalMax !== null && decimalMin > decimalMax) {
        messages.push(this.chill.T('A36EB919-7C96-4C93-A29C-5A4350E3B995', 'Decimal min value cannot exceed decimal max value.', 'Il valore decimale minimo non può superare il valore decimale massimo.'));
      }
      if (draft.decimalPlaces.trim() && this.parseOptionalInteger(draft.decimalPlaces) === null) {
        messages.push(this.chill.T('D01A619A-28B0-42B7-B246-8799D6A0F6D0', 'Decimal places must be an integer.', 'Le cifre decimali devono essere un intero.'));
      }
      if (draft.precision.trim() && this.parseOptionalInteger(draft.precision) === null) {
        messages.push(this.chill.T('3AB179E4-AC9A-40AA-A1A1-B81232A3FEA1', 'Precision must be an integer.', 'La precisione deve essere un intero.'));
      }
      if (draft.scale.trim() && this.parseOptionalInteger(draft.scale) === null) {
        messages.push(this.chill.T('5753A4E0-14B3-4E43-91E6-1592F6E87045', 'Scale must be an integer.', 'La scala deve essere un intero.'));
      }
    }

    if (this.showRegexPattern() && draft.regexPattern.trim()) {
      try {
        new RegExp(draft.regexPattern);
      } catch {
        messages.push(this.chill.T('6A78E1B5-7733-4663-8A7D-E4E4F09AE499', 'Regex pattern is invalid.', 'Il pattern regex non è valido.'));
      }
    }

    if (this.showEnumValues() && this.parseEnumOptions(draft.enumValues).length === 0) {
      messages.push(this.chill.T('18D2378E-C16D-4220-924C-0BC6F3EE62C4', 'Select properties need at least one enum value.', 'Le proprietà select richiedono almeno un valore enum.'));
    }

    return messages;
  }

  private buildProperty(source: ChillPropertySchema, draft: SchemaPropertyDraft): ChillPropertySchema {
    const metadataResult = this.tryParseMetadata(draft.metadataJson);
    const metadata: ChillMetadataRecord = metadataResult.ok ? { ...metadataResult.value } : {};
    for (const key of MANAGED_METADATA_KEYS) {
      delete metadata[key];
    }

    metadata['required'] = draft.isNullable ? 'false' : 'true';
    if (draft.isReadOnly) {
      metadata['readonly'] = 'true';
    }

    const minLength = this.showLengthSettings() ? this.parseOptionalInteger(draft.minLength) : null;
    const maxLength = this.showLengthSettings() ? this.parseOptionalInteger(draft.maxLength) : null;
    const regexPattern = this.showRegexPattern() ? draft.regexPattern.trim() : '';
    if (minLength !== null) {
      metadata['minLength'] = String(minLength);
    }
    if (maxLength !== null) {
      metadata['maxLength'] = String(maxLength);
    }
    if (regexPattern) {
      metadata['pattern'] = regexPattern;
    }

    const integerMinValue = this.showIntegerRange() ? this.parseOptionalInteger(draft.integerMinValue) : null;
    const integerMaxValue = this.showIntegerRange() ? this.parseOptionalInteger(draft.integerMaxValue) : null;
    const decimalMinValue = this.showDecimalSettings() ? this.parseOptionalDecimal(draft.decimalMinValue) : null;
    const decimalMaxValue = this.showDecimalSettings() ? this.parseOptionalDecimal(draft.decimalMaxValue) : null;
    const decimalPlaces = this.showDecimalSettings() ? this.parseOptionalInteger(draft.decimalPlaces) : null;
    const precision = this.showDecimalSettings() ? this.parseOptionalInteger(draft.precision) : null;
    const scale = this.showDecimalSettings() ? this.parseOptionalInteger(draft.scale) : null;

    if (integerMinValue !== null) {
      metadata['min'] = String(integerMinValue);
    } else if (decimalMinValue !== null) {
      metadata['min'] = String(decimalMinValue);
    }
    if (integerMaxValue !== null) {
      metadata['max'] = String(integerMaxValue);
    } else if (decimalMaxValue !== null) {
      metadata['max'] = String(decimalMaxValue);
    }

    const enumOptions = this.showEnumValues() ? this.parseEnumOptions(draft.enumValues) : [];
    if (enumOptions.length > 0) {
      metadata['options'] = enumOptions.map((option) => [option.value, option.label]);
    }

    return {
      ...source,
      name: draft.name.trim(),
      displayName: draft.displayName.trim() || draft.name.trim(),
      propertyType: draft.propertyType,
      simplePropertyType: chillSimplePropertyType(draft.propertyType),
      isNullable: draft.isNullable,
      isReadOnly: draft.isReadOnly,
      minLength,
      maxLength,
      integerMinValue,
      integerMaxValue,
      decimalMinValue,
      decimalMaxValue,
      decimalPlaces,
      precision,
      scale,
      dateFormat: this.showDateFormat() ? draft.dateFormat.trim() : '',
      customFormat: this.showCustomFormat() ? draft.customFormat.trim() : '',
      regexPattern,
      enumValues: enumOptions.length > 0 ? enumOptions.map((option) => option.value) : null,
      metadata
    };
  }

  private parseEnumOptions(value: string): Array<{ value: string; label: string }> {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex < 0) {
          return { value: line, label: line };
        }

        const optionValue = line.slice(0, separatorIndex).trim();
        const optionLabel = line.slice(separatorIndex + 1).trim();
        return {
          value: optionValue || optionLabel,
          label: optionLabel || optionValue
        };
      })
      .filter((option) => option.value.length > 0 && option.label.length > 0);
  }

  private serializeEnumValues(property: ChillPropertySchema): string {
    const enumValues = Array.isArray(property.enumValues)
      ? property.enumValues.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (enumValues.length > 0) {
      return enumValues.join('\n');
    }

    const rawOptions = property.metadata?.['options'];
    if (!Array.isArray(rawOptions)) {
      return '';
    }

    return rawOptions.flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return [];
      }

      const [value, label] = entry;
      const normalizedValue = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
      const normalizedLabel = typeof label === 'string' || typeof label === 'number' ? String(label).trim() : '';
      if (!normalizedValue || !normalizedLabel) {
        return [];
      }

      return [normalizedValue === normalizedLabel ? normalizedValue : `${normalizedValue} = ${normalizedLabel}`];
    }).join('\n');
  }

  private tryParseMetadata(value: string): { ok: true; value: ChillMetadataRecord } | { ok: false } {
    const normalized = value.trim();
    if (!normalized) {
      return { ok: true, value: {} };
    }

    try {
      const parsed = JSON.parse(normalized);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false };
      }

      return { ok: true, value: parsed as ChillMetadataRecord };
    } catch {
      return { ok: false };
    }
  }

  private stringifyMetadata(metadata: ChillMetadataRecord | undefined): string {
    try {
      return JSON.stringify(metadata ?? {}, null, 2);
    } catch {
      return '{\n  \n}';
    }
  }

  private readMetadataNumber(metadata: ChillMetadataRecord | undefined, key: string): number | null {
    const value = metadata?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private readMetadataString(metadata: ChillMetadataRecord | undefined, key: string): string {
    const value = metadata?.[key];
    return typeof value === 'string'
      ? value.trim()
      : typeof value === 'number'
        ? String(value)
        : '';
  }

  private readBooleanMetadata(metadata: ChillMetadataRecord | undefined, key: string): boolean {
    const value = this.readMetadataString(metadata, key).toLowerCase();
    return value === 'true' || value === '1' || value === 'readonly';
  }

  private parseOptionalInteger(value: string): number | null {
    const normalized = value.trim();
    if (!normalized || !/^-?\d+$/.test(normalized)) {
      return normalized ? null : null;
    }

    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  private parseOptionalDecimal(value: string): number | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatOptionalNumber(value: number | null | undefined): string {
    return value === null || value === undefined || Number.isNaN(value)
      ? ''
      : String(value);
  }
}
