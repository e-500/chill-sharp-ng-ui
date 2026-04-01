import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AbstractControl, AsyncValidatorFn, FormControl, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillValidationError } from 'chill-sharp-ts-client';
import { catchError, firstValueFrom, map, of, switchMap, timer } from 'rxjs';
import type {
  ChillEntity,
  ChillFormSubmitEvent,
  ChillPropertySchema,
  ChillQuery,
  ChillSchema
} from '../models/chill-schema.models';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillPolymorphicInputComponent } from './chill-polymorphic-input.component';
import { ChillService } from '../services/chill.service';
import { ChillI18nLabelComponent } from './chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from './chill-i18n-button-label.component';

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
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ChillPolymorphicInputComponent, ChillI18nLabelComponent, ChillI18nButtonLabelComponent],
  templateUrl: './chill-form.component.html',
  styleUrl: './chill-form.component.scss'   
})
export class ChillFormComponent {
  readonly columnOptions = [1, 2, 3, 4, 5, 6];
  readonly chill = inject(ChillService);
  readonly layout = inject(WorkspaceLayoutService);
  readonly dialog = inject(WorkspaceDialogService, { optional: true });
  readonly schema = input<ChillSchema | null>(null);
  readonly entity = input<ChillEntity | null>(null);
  readonly query = input<ChillQuery | null>(null);
  readonly submitLabel = input(this.chill.T('22282CD9-6B51-4B50-87BE-36E3790D4B8D', 'Submit', 'Invia'));
  readonly submitLabelGuid = input<string | null>(null);
  readonly submitPrimaryDefaultText = input<string | null>(null);
  readonly submitSecondaryDefaultText = input<string | null>(null);
  readonly renderSubmitInsideForm = input(true);
  readonly onSubmit = input<((event: ChillFormSubmitEvent) => void) | null>(null);
  readonly closeDialogOnSubmit = input(false);
  readonly submitError = input<string | (() => string) | null>(null);
  readonly dismissSubmitError = input<(() => void) | null>(null);

  readonly formSubmit = output<ChillFormSubmitEvent>();

  readonly form = signal<FormGroup<Record<string, FormControl<JsonValue>>> | null>(null);
  readonly propertyValidity = signal<Record<string, boolean>>({});
  readonly serverFieldErrors = signal<Record<string, string>>({});
  readonly genericValidationErrors = signal<string[]>([]);
  readonly isEditMode = signal(false);
  readonly isSavingLayout = signal(false);
  readonly layoutError = signal('');
  readonly dragPropertyName = signal('');
  readonly layoutState = signal<FormLayoutState>({
    columnCount: DEFAULT_FORM_COLUMN_COUNT,
    items: []
  });
  private autocompleteRequestSequence = 0;
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
  readonly canSubmit = computed(() => {
    const form = this.form();
    if (this.isEditMode()) {
      return false;
    }

    if (Object.keys(this.serverFieldErrors()).length > 0) {
      return false;
    }

    if (form?.pending || form?.invalid) {
      return false;
    }

    return this.layoutItems()
      .filter((item): item is Extract<ResolvedFormLayoutItem, { kind: 'property' }> => item.kind === 'property')
      .every((item) => this.propertyValidity()[item.property.name] !== false);
  });
  readonly resolvedSubmitError = computed(() => {
    const submitError = this.submitError();
    if (typeof submitError === 'function') {
      return submitError().trim();
    }

    return typeof submitError === 'string'
      ? submitError.trim()
      : '';
  });
  readonly genericValidationMessage = computed(() => this.genericValidationErrors().join(' ').trim());

  constructor() {
    effect(() => {
      const schema = this.schema();
      const source = this.source();
      this.form.set(schema
        ? this.chill.prepareForm(schema, source, {
            createControlAsyncValidators: ({ property, getForm }) => this.shouldUseAsyncServerValidation()
              ? this.createServerFieldAsyncValidator(property.name, getForm)
              : null
          })
        : null);
      this.propertyValidity.set(this.createInitialPropertyValidity(schema));
      this.serverFieldErrors.set({});
      this.genericValidationErrors.set([]);
      this.layoutState.set(this.readLayoutState(schema));
      this.layoutError.set('');
      this.isEditMode.set(false);

      if (schema?.properties?.length) {
        untracked(() => {
          void this.runAutocomplete();
        });
      }
    });

    effect(() => {
      if (!this.layout.isLayoutEditingEnabled()) {
        this.isEditMode.set(false);
      }
    });
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    if (this.shouldValidateOnSubmit()) {
      const isValid = await this.validateCurrentPayload();
      if (!isValid) {
        return;
      }
    }

    const payload = this.mode() === 'query'
      ? this.buildQueryPayload()
      : this.buildEntityPayload();
    const event: ChillFormSubmitEvent = {
      kind: this.mode(),
      value: payload
    };

    this.formSubmit.emit(event);
    this.onSubmit()?.(event);

    if (this.closeDialogOnSubmit()) {
      this.dialog?.confirm();
    }
  }

  toggleEditMode(): void {
    if (!this.layout.isLayoutEditingEnabled()) {
      return;
    }

    if (!this.isEditMode()) {
      this.isEditMode.set(true);
      this.layoutError.set('');
      return;
    }

    this.saveLayout();
  }

  updateFields(value: Record<string, JsonValue>): void {
    const incomingFieldNames = Object.keys(value)
      .map((fieldName) => fieldName.trim())
      .filter((fieldName) => fieldName.length > 0);
    const form = this.form();
    if (!form) {
      return;
    }

    for (const [fieldName, fieldValue] of Object.entries(value)) {
      const control = form.controls[fieldName];
      if (!control || Object.is(control.value, fieldValue)) {
        continue;
      }

      control.setValue(fieldValue);
    }

    if (incomingFieldNames.length > 0) {
      this.clearServerValidationForFields(incomingFieldNames);
    }
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

  canDialogSubmit(): boolean {
    return this.canSubmit();
  }

  clearSubmitError(): void {
    this.dismissSubmitError()?.();
  }

  handlePropertyBlur(value: Record<string, JsonValue>): void {
    this.updateFields(value);
    queueMicrotask(() => {
      void this.runAutocomplete();
    });
  }

  private buildEntityPayload(): ChillEntity {
    const entity = this.entity();
    return {
      ...(entity ?? {}),
      properties: this.buildPropertiesObject(this.form())
    };
  }

  private buildQueryPayload(): ChillQuery {
    const query = this.query();
    return {
      ...(query ?? {}),
      properties: this.buildPropertiesObject(this.form())
    };
  }

  private buildPropertiesObject(formOverride: FormGroup<Record<string, FormControl<JsonValue>>> | null): Record<string, JsonValue> {
    const properties: Record<string, JsonValue> = {};
    const schema = this.schema();
    const formValue = formOverride?.getRawValue() ?? {};

    for (const property of this.properties()) {
      const rawValue = formValue[property.name];
      properties[property.name] = this.chill.toJsonValue(schema, property.name, rawValue);
    }

    return properties;
  }

  private async runAutocomplete(): Promise<void> {
    const schema = this.schema();
    if (!schema || this.isEditMode()) {
      return;
    }

    const requestSequence = ++this.autocompleteRequestSequence;
    const request = this.buildCurrentPayload();

    try {
      const response = await firstValueFrom(this.chill.autocomplete(request as JsonObject));
      if (requestSequence !== this.autocompleteRequestSequence) {
        return;
      }

      const autocompletedFields = this.extractAutocompleteFields(schema, response);
      if (Object.keys(autocompletedFields).length > 0) {
        this.updateFields(autocompletedFields);
      }

    } catch {
      if (requestSequence === this.autocompleteRequestSequence) {
        return;
      }
    }
  }

  private buildCurrentPayload(): ChillEntity | ChillQuery {
    return this.mode() === 'query'
      ? this.buildQueryPayload()
      : this.buildEntityPayload();
  }

  private buildPayloadFromForm(form: FormGroup<Record<string, FormControl<JsonValue>>>): ChillEntity | ChillQuery {
    const properties = this.buildPropertiesObject(form);
    if (this.mode() === 'query') {
      return {
        ...(this.query() ?? {}),
        properties
      };
    }

    return {
      ...(this.entity() ?? {}),
      properties
    };
  }

  private shouldValidateOnSubmit(): boolean {
    return !!this.dialog && this.mode() === 'entity';
  }

  private shouldUseAsyncServerValidation(): boolean {
    return !!this.dialog && this.mode() === 'entity';
  }

  private extractAutocompleteFields(schema: ChillSchema, response: JsonObject): Record<string, JsonValue> {
    const nextFields: Record<string, JsonValue> = {};

    for (const property of schema.properties ?? []) {
      const autocompletedValue = this.readResponsePropertyValue(response, property.name);
      if (autocompletedValue !== undefined) {
        nextFields[property.name] = autocompletedValue;
      }
    }

    return nextFields;
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

  private createInitialPropertyValidity(schema: ChillSchema | null): Record<string, boolean> {
    return Object.fromEntries(
      (schema?.properties ?? []).map((property) => [property.name, true] as const)
    );
  }

  private createServerFieldAsyncValidator(
    propertyName: string,
    getForm: () => FormGroup<Record<string, FormControl<JsonValue>>>
  ): AsyncValidatorFn {
    return (control: AbstractControl) => {
      if (!control.dirty && !control.touched) {
        return of(null);
      }

      return timer(250).pipe(
        switchMap(() => this.chill.validate(this.buildPayloadFromForm(getForm()) as JsonObject)),
        map((errors) => {
          const validationErrors = this.toAsyncValidationErrors(errors, propertyName);
          this.syncServerFieldError(propertyName, validationErrors?.['serverValidation']);
          return validationErrors;
        }),
        catchError(() => of(null))
      );
    };
  }

  private toAsyncValidationErrors(
    errors: ChillValidationError[],
    propertyName: string
  ): ValidationErrors | null {
    const schema = this.schema();
    if (!schema) {
      return null;
    }

    const { fieldErrors } = this.partitionValidationErrors(errors, schema);
    const message = fieldErrors[propertyName]?.trim();
    return message
      ? { serverValidation: message }
      : null;
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

  private readResponsePropertyValue(source: JsonObject, propertyName: string): JsonValue | undefined {
    const directProperties = source['properties'];
    if (directProperties && typeof directProperties === 'object' && !Array.isArray(directProperties) && propertyName in directProperties) {
      return (directProperties as Record<string, JsonValue>)[propertyName];
    }

    const pascalProperties = source['Properties'];
    if (pascalProperties && typeof pascalProperties === 'object' && !Array.isArray(pascalProperties) && propertyName in pascalProperties) {
      return (pascalProperties as Record<string, JsonValue>)[propertyName];
    }

    if (propertyName in source) {
      return source[propertyName];
    }

    const pascalPropertyName = propertyName.length > 0
      ? `${propertyName[0].toUpperCase()}${propertyName.slice(1)}`
      : propertyName;
    return pascalPropertyName in source
      ? source[pascalPropertyName]
      : undefined;
  }

  private clearServerValidationForFields(fieldNames: string[]): void {
    if (fieldNames.length === 0) {
      return;
    }

    const normalizedFieldNames = new Set(fieldNames.map((fieldName) => fieldName.trim().toLowerCase()).filter((fieldName) => fieldName.length > 0));
    this.serverFieldErrors.update((current) => {
      let changed = false;
      const nextEntries = Object.entries(current).filter(([fieldName]) => {
        const shouldKeep = !normalizedFieldNames.has(fieldName.trim().toLowerCase());
        if (!shouldKeep) {
          changed = true;
        }
        return shouldKeep;
      });
      return changed ? Object.fromEntries(nextEntries) : current;
    });
    this.genericValidationErrors.set([]);
  }

  private syncServerFieldError(propertyName: string, message: unknown): void {
    const normalizedPropertyName = propertyName.trim();
    if (!normalizedPropertyName) {
      return;
    }

    const normalizedMessage = typeof message === 'string'
      ? message.trim()
      : '';

    this.serverFieldErrors.update((current) => {
      if (!normalizedMessage) {
        if (!(normalizedPropertyName in current)) {
          return current;
        }

        const { [normalizedPropertyName]: _, ...rest } = current;
        return rest;
      }

      if (current[normalizedPropertyName] === normalizedMessage) {
        return current;
      }

      return {
        ...current,
        [normalizedPropertyName]: normalizedMessage
      };
    });
  }

  private async validateCurrentPayload(): Promise<boolean> {
    const schema = this.schema();
    if (!schema) {
      return true;
    }

    try {
      const errors = await firstValueFrom(this.chill.validate(this.buildCurrentPayload() as JsonObject));
      const { fieldErrors, genericErrors } = this.partitionValidationErrors(errors, schema);
      this.serverFieldErrors.set(fieldErrors);
      this.genericValidationErrors.set(genericErrors);
      return Object.keys(fieldErrors).length === 0 && genericErrors.length === 0;
    } catch (error: unknown) {
      this.genericValidationErrors.set([this.chill.formatError(error)]);
      return false;
    }
  }

  private partitionValidationErrors(
    errors: ChillValidationError[],
    schema: ChillSchema
  ): { fieldErrors: Record<string, string>; genericErrors: string[] } {
    const fieldNameMap = new Map(
      (schema.properties ?? [])
        .map((property) => property.name.trim())
        .filter((propertyName) => propertyName.length > 0)
        .map((propertyName) => [propertyName.toLowerCase(), propertyName] as const)
    );
    const fieldErrors: Record<string, string> = {};
    const genericErrors: string[] = [];

    for (const error of errors) {
      const fieldName = typeof error.fieldName === 'string' ? error.fieldName.trim() : '';
      const message = typeof error.message === 'string' ? error.message.trim() : '';
      if (!message) {
        continue;
      }

      const resolvedFieldName = fieldName ? fieldNameMap.get(fieldName.toLowerCase()) : undefined;
      if (resolvedFieldName) {
        fieldErrors[resolvedFieldName] = fieldErrors[resolvedFieldName]
          ? `${fieldErrors[resolvedFieldName]} ${message}`
          : message;
        continue;
      }

      genericErrors.push(message);
    }

    return { fieldErrors, genericErrors };
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
