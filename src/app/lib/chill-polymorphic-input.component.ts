import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import { Subscription } from 'rxjs';
import { CHILL_PROPERTY_TYPE, type ChillEntity, type ChillPropertySchema, type ChillSchema } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';

type FieldValueMap = Record<string, JsonValue>;
type ErrorMap = Record<string, string>;

interface LookupState {
  term: string;
  isSearching: boolean;
  error: string;
  results: JsonObject[];
  selectedGuid: string;
}

@Component({
  selector: 'app-chill-polymorphic-input',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './chill-polymorphic-input.component.html',
  styleUrl: './chill-polymorphic-input.component.scss'
})
export class ChillPolymorphicInputComponent implements OnDestroy {
  readonly chill = inject(ChillService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly form = input<FormGroup<Record<string, FormControl<JsonValue>>> | null>(null);
  readonly schema = input<ChillSchema | null>(null);
  readonly propertyNames = input<string[] | null>(null);
  readonly externalErrors = input<Record<string, string> | null>(null);
  readonly showLabels = input(true);

  readonly valueChange = output<Record<string, JsonValue>>();
  readonly validityChange = output<boolean>();
  readonly fieldBlur = output<Record<string, JsonValue>>();

  readonly fieldValues = signal<FieldValueMap>({});
  readonly errors = signal<ErrorMap>({});
  readonly lookups = signal<Record<string, LookupState>>({});
  private readonly lookupSearchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lookupRequestSequence = new Map<string, number>();
  private controlSubscriptions = new Subscription();

  readonly properties = computed(() => {
    const allowedPropertyNames = this.propertyNames();
    const allowedSet = allowedPropertyNames ? new Set(allowedPropertyNames) : null;

    return (this.schema()?.properties ?? []).filter((property) => {
      if (this.shouldSkipProperty(property)) {
        return false;
      }

      return allowedSet ? allowedSet.has(property.name) : true;
    });
  });
  readonly resolvedErrors = computed<ErrorMap>(() => {
    const next: ErrorMap = {
      ...this.errors()
    };
    for (const property of this.properties()) {
      const controlError = this.readControlValidationMessage(property.name);
      if (controlError) {
        next[property.name] = controlError;
      }
    }
    const externalErrors = this.externalErrors() ?? {};
    const propertyNameMap = new Map(
      this.properties()
        .map((property) => property.name.trim())
        .filter((propertyName) => propertyName.length > 0)
        .map((propertyName) => [propertyName.toLowerCase(), propertyName] as const)
    );
    for (const [fieldName, message] of Object.entries(externalErrors)) {
      const normalizedMessage = message.trim();
      if (normalizedMessage) {
        const resolvedFieldName = propertyNameMap.get(fieldName.trim().toLowerCase()) ?? fieldName;
        next[resolvedFieldName] = normalizedMessage;
      }
    }
    return next;
  });
  readonly isValid = computed(() => this.properties().every((property) => !this.resolvedErrors()[property.name]));

  constructor() {
    effect(() => {
      const properties = this.properties();
      const form = this.form();
      const fields = this.readFormValues(properties);
      const errors = this.validateAllFields(properties, fields);
      const lookups = this.createLookupState(properties, fields);

      this.controlSubscriptions.unsubscribe();
      this.controlSubscriptions = new Subscription();
      for (const property of properties) {
        const control = this.control(property.name);
        if (!control) {
          continue;
        }

        this.controlSubscriptions.add(control.valueChanges.subscribe((value) => {
          this.fieldValues.update((current) => ({
            ...current,
            [property.name]: value
          }));
          this.syncLookupState(property, value);
          this.validateField(property);
        }));
      }

      if (!form) {
        this.fieldValues.set({});
        this.errors.set({});
        this.lookups.set({});
        return;
      }

      this.fieldValues.update((current) => this.areRecordsEqual(current, fields) ? current : fields);
      this.errors.update((current) => this.areStringRecordsEqual(current, errors) ? current : errors);
      this.lookups.update((current) => this.areLookupStatesEqual(current, lookups) ? current : lookups);
    });

    effect(() => {
      this.valueChange.emit(this.fieldValues());
      this.validityChange.emit(this.isValid());
    });
  }

  isCheckbox(property: ChillPropertySchema): boolean {
    return property.propertyType === CHILL_PROPERTY_TYPE.Boolean;
  }

  isTextarea(property: ChillPropertySchema): boolean {
    return property.propertyType === CHILL_PROPERTY_TYPE.Text
      || property.customFormat?.toLowerCase() === 'textarea'
      || property.metadata?.['multiline']?.toLowerCase() === 'true';
  }

  isLookup(property: ChillPropertySchema): boolean {
    return property.propertyType === CHILL_PROPERTY_TYPE.ChillEntity
      || property.propertyType === CHILL_PROPERTY_TYPE.ChillQuery;
  }

  isLookupCollection(property: ChillPropertySchema): boolean {
    return property.propertyType === CHILL_PROPERTY_TYPE.ChillEntityCollection;
  }

  inputType(property: ChillPropertySchema): 'text' | 'number' {
    return property.propertyType === CHILL_PROPERTY_TYPE.Integer
      || property.propertyType === CHILL_PROPERTY_TYPE.Decimal
      ? 'number'
      : 'text';
  }

  inputStep(property: ChillPropertySchema): string | null {
    const metadataStep = property.metadata?.['step']?.trim();
    if (metadataStep) {
      return metadataStep;
    }

    if (property.propertyType === CHILL_PROPERTY_TYPE.Integer) {
      return '1';
    }

    if (property.propertyType === CHILL_PROPERTY_TYPE.Decimal) {
      return 'any';
    }

    return null;
  }

  placeholder(property: ChillPropertySchema): string {
    const explicitPlaceholder = property.metadata?.['placeholder']?.trim() ?? '';
    if (explicitPlaceholder) {
      return explicitPlaceholder;
    }

    return this.showLabels()
      ? ''
      : property.displayName?.trim() || property.name;
  }

  textValue(propertyName: string): string {
    const value = this.fieldValues()[propertyName];
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  booleanValue(propertyName: string): boolean {
    return this.fieldValues()[propertyName] === true;
  }

  lookupTerm(propertyName: string): string {
    return this.lookups()[propertyName]?.term ?? '';
  }

  lookupResults(propertyName: string): JsonObject[] {
    return this.lookups()[propertyName]?.results ?? [];
  }

  lookupError(propertyName: string): string {
    return this.lookups()[propertyName]?.error ?? '';
  }

  lookupIsSearching(propertyName: string): boolean {
    return this.lookups()[propertyName]?.isSearching ?? false;
  }

  canOpenLookupDialog(property: ChillPropertySchema): boolean {
    return (
      property.propertyType === CHILL_PROPERTY_TYPE.ChillEntity
      || property.propertyType === CHILL_PROPERTY_TYPE.ChillEntityCollection
    ) && !!property.chillType?.trim();
  }

  lookupCollectionSummary(propertyName: string): string {
    return this.collectionLookupLabels(propertyName).join(', ');
  }

  collectionLookupLabels(propertyName: string): string[] {
    const value = this.fieldValues()[propertyName];
    return Array.isArray(value)
      ? value.filter((item): item is JsonObject => this.isJsonObject(item)).map((item) => this.lookupLabel(item)).filter((item) => item.length > 0)
      : [];
  }

  validationMessage(propertyName: string): string {
    return this.resolvedErrors()[propertyName] ?? '';
  }

  normalizeTextOnBlur(property: ChillPropertySchema): void {
    const currentValue = this.fieldValues()[property.name];
    if (typeof currentValue !== 'string') {
      this.notifyFieldBlur(property.name);
      return;
    }

    const normalizedValue = this.normalizeBlurValue(property, currentValue);
    if (normalizedValue === null) {
      this.validateField(property);
      this.notifyFieldBlur(property.name);
      return;
    }

    this.setFieldValue(property.name, normalizedValue);
    this.validateField(property);
    this.notifyFieldBlur(property.name);
  }

  updateLookupTerm(property: ChillPropertySchema, value: string): void {
    const previousLookup = this.lookups()[property.name] ?? this.createEmptyLookupState();
    this.lookups.update((current) => ({
      ...current,
      [property.name]: {
        ...previousLookup,
        term: value,
        error: '',
        selectedGuid: this.matchesLookupLabel(previousLookup.term, value) ? previousLookup.selectedGuid : ''
      }
    }));

    if (!value.trim()) {
      this.cancelLookupSearch(property.name);
      this.setFieldValue(property.name, null);
      this.lookups.update((current) => ({
        ...current,
        [property.name]: {
          ...(current[property.name] ?? this.createEmptyLookupState()),
          results: []
        }
      }));
      this.validateField(property);
      return;
    }

    this.scheduleLookupSearch(property, value);
  }

  handleLookupFocus(property: ChillPropertySchema): void {
    const lookup = this.lookups()[property.name] ?? this.createEmptyLookupState();
    if (lookup.term.trim() && lookup.results.length === 0) {
      this.scheduleLookupSearch(property, lookup.term);
    }
  }

  handleLookupBlur(propertyName: string): void {
    this.notifyFieldBlur(propertyName);
    window.setTimeout(() => {
      this.lookups.update((current) => {
        const lookup = current[propertyName];
        if (!lookup) {
          return current;
        }

        return {
          ...current,
          [propertyName]: {
            ...lookup,
            results: []
          }
        };
      });
    }, 120);
  }

  emitFieldBlur(propertyName: string): void {
    this.notifyFieldBlur(propertyName);
  }

  async openLookupDialog(property: ChillPropertySchema): Promise<void> {
    const chillType = property.chillType?.trim() ?? '';
    if (!chillType) {
      this.setLookupError(property.name, this.chill.T('7E0D5F0F-CDA4-4F49-8E02-A7E0E854B65A', 'Lookup schema is unavailable.', 'Lo schema di ricerca non è disponibile.'));
      return;
    }

    const currentValue = this.fieldValues()[property.name];
    const selectedEntity = this.isJsonObject(currentValue) ? currentValue as ChillEntity : null;
    const selectedEntities = Array.isArray(currentValue)
      ? currentValue.filter((item): item is ChillEntity => this.isJsonObject(item))
      : [];
    const { CrudTaskComponent } = await import('../tasks/crud-task/crud-task.component');
    const result = await this.dialog.openDialog<ChillEntity | ChillEntity[] | null>({
      title: property.displayName?.trim() || property.name,
      component: CrudTaskComponent,
      inputs: {
        initialChillType: chillType,
        initialViewCode: 'default',
        selectionEnabled: true,
        multipleSelection: this.isLookupCollection(property),
        initialSelectedEntity: selectedEntity,
        initialSelectedEntities: selectedEntities,
        toolbarScope: 'dialog'
      }
    });

    if (result.status !== 'confirmed' || !result.value) {
      return;
    }

    if (Array.isArray(result.value)) {
      this.selectLookupResults(property, result.value);
      return;
    }

    this.selectLookupResult(property, result.value);
  }

  private searchLookup(property: ChillPropertySchema, rawSearchTerm: string): void {
    const lookup = this.lookups()[property.name] ?? this.createEmptyLookupState();
    const searchTerm = rawSearchTerm.trim();
    const targetChillType = property.chillType?.trim() ?? '';
    const requestSequence = (this.lookupRequestSequence.get(property.name) ?? 0) + 1;
    this.lookupRequestSequence.set(property.name, requestSequence);

    if (!targetChillType) {
      this.setLookupError(property.name, this.chill.T('7E0D5F0F-CDA4-4F49-8E02-A7E0E854B65A', 'Lookup schema is unavailable.', 'Lo schema di ricerca non è disponibile.'));
      return;
    }

    if (!searchTerm) {
      this.setLookupError(property.name, this.chill.T('8B0ED598-819C-42E5-B41A-439F7066EEA9', 'Enter a search value first.', 'Inserisci prima un valore di ricerca.'));
      return;
    }

    this.lookups.update((current) => ({
      ...current,
      [property.name]: {
        ...lookup,
        isSearching: true,
        error: '',
        results: [],
        term: rawSearchTerm
      }
    }));

    this.chill.query({
      chillType: targetChillType,
      properties: {
        FullTextSearch: searchTerm
      },
      resultProperties: [
        { PropertyName: 'Guid' },
        { PropertyName: 'Label' },
        { PropertyName: 'DisplayName' },
        { PropertyName: 'Name' }
      ]
    }).subscribe({
      next: (response) => {
        if (this.lookupRequestSequence.get(property.name) !== requestSequence) {
          return;
        }

        this.lookups.update((current) => ({
          ...current,
          [property.name]: {
            ...(current[property.name] ?? this.createEmptyLookupState()),
            term: rawSearchTerm,
            isSearching: false,
            error: '',
            results: this.extractLookupResults(response)
          }
        }));
      },
      error: (error: unknown) => {
        if (this.lookupRequestSequence.get(property.name) !== requestSequence) {
          return;
        }
        this.setLookupError(property.name, this.chill.formatError(error), false);
      }
    });
  }

  selectLookupResult(property: ChillPropertySchema, result: JsonObject): void {
    this.setFieldValue(property.name, result);
    const selectedGuid = this.lookupGuid(result);
    this.lookups.update((current) => ({
      ...current,
      [property.name]: {
        ...(current[property.name] ?? this.createEmptyLookupState()),
        term: this.lookupLabel(result),
        isSearching: false,
        error: '',
        results: [],
        selectedGuid
      }
    }));
    this.validateField(property);
  }

  selectLookupResults(property: ChillPropertySchema, results: JsonObject[]): void {
    this.setFieldValue(property.name, results);
    this.lookups.update((current) => ({
      ...current,
      [property.name]: {
        ...(current[property.name] ?? this.createEmptyLookupState()),
        term: results.map((result) => this.lookupLabel(result)).filter((label) => label.length > 0).join(', '),
        isSearching: false,
        error: '',
        results: [],
        selectedGuid: ''
      }
    }));
    this.validateField(property);
  }

  clearLookup(property: ChillPropertySchema): void {
    this.setFieldValue(property.name, this.isLookupCollection(property) ? [] : null);
    this.lookups.update((current) => ({
      ...current,
      [property.name]: this.createEmptyLookupState()
    }));
    this.validateField(property);
  }

  lookupLabel(result: JsonObject): string {
    const label = result['Label']
      ?? result['DisplayName']
      ?? result['Name']
      ?? result['Guid'];

    if (typeof label === 'string' && label.trim()) {
      return label.trim();
    }

    if (typeof label === 'number' || typeof label === 'boolean') {
      return String(label);
    }

    return '';
  }

  lookupGuid(result: JsonObject): string {
    const guid = result['Guid'] ?? result['guid'];
    if (typeof guid === 'string' && guid.trim()) {
      return guid.trim();
    }

    return '';
  }

  isLookupResultSelected(propertyName: string, result: JsonObject): boolean {
    const selectedGuid = this.lookups()[propertyName]?.selectedGuid ?? '';
    return !!selectedGuid && this.lookupGuid(result) === selectedGuid;
  }

  ngOnDestroy(): void {
    this.controlSubscriptions.unsubscribe();
    for (const timer of this.lookupSearchTimers.values()) {
      clearTimeout(timer);
    }
    this.lookupSearchTimers.clear();
  }

  control(propertyName: string): FormControl<JsonValue> | null {
    return this.form()?.controls[propertyName] ?? null;
  }

  private readFormValues(properties: ChillPropertySchema[]): FieldValueMap {
    const nextState: FieldValueMap = {};

    for (const property of properties) {
      const control = this.control(property.name);
      nextState[property.name] = this.normalizeFieldValue(property, control?.value);
    }

    return nextState;
  }

  private createLookupState(properties: ChillPropertySchema[], fields: FieldValueMap): Record<string, LookupState> {
    const nextState: Record<string, LookupState> = {};

    for (const property of properties) {
      if (!this.isLookup(property) && !this.isLookupCollection(property)) {
        continue;
      }

      const value = fields[property.name];
      nextState[property.name] = {
        term: this.isLookupCollection(property)
          ? this.lookupCollectionSummaryFromValue(value)
          : this.isJsonObject(value) ? this.lookupLabel(value) : '',
        isSearching: false,
        error: '',
        results: [],
        selectedGuid: this.isJsonObject(value) ? this.lookupGuid(value) : ''
      };
    }

    return nextState;
  }

  private normalizeFieldValue(property: ChillPropertySchema, value: JsonValue | undefined): JsonValue {
    if (value === undefined) {
      return this.isLookupCollection(property) ? [] : '';
    }

    return value;
  }

  private validateAllFields(properties: ChillPropertySchema[], fields: FieldValueMap): ErrorMap {
    const nextErrors: ErrorMap = {};

    for (const property of properties) {
      const error = this.getValidationMessage(property, fields[property.name]);
      if (error) {
        nextErrors[property.name] = error;
      }
    }

    return nextErrors;
  }

  private validateField(property: ChillPropertySchema): void {
    const message = this.getValidationMessage(property, this.fieldValues()[property.name]);
    this.errors.update((current) => {
      if (!message) {
        const { [property.name]: _, ...rest } = current;
        return rest;
      }

      return {
        ...current,
        [property.name]: message
      };
    });
  }

  private readControlValidationMessage(propertyName: string): string {
    const errors = this.control(propertyName)?.errors;
    if (!errors) {
      return '';
    }

    const serverValidation = errors['serverValidation'];
    return typeof serverValidation === 'string'
      ? serverValidation.trim()
      : '';
  }

  private getValidationMessage(property: ChillPropertySchema, value: JsonValue | undefined): string {
    if (this.isEmptyValue(value)) {
      return this.isRequired(property)
        ? this.chill.T('7E64BA1D-8E3B-450D-B03B-A6E2E7B6EC9A', 'This field is required.', 'Questo campo è obbligatorio.')
        : '';
    }

    const propertyType = property.propertyType ?? CHILL_PROPERTY_TYPE.Unknown;
    switch (propertyType) {
      case CHILL_PROPERTY_TYPE.Guid:
        return this.validateGuid(value);
      case CHILL_PROPERTY_TYPE.Integer:
        return this.validateInteger(value, property);
      case CHILL_PROPERTY_TYPE.Decimal:
        return this.validateDecimal(value, property);
      case CHILL_PROPERTY_TYPE.Date:
        return this.validateDate(value);
      case CHILL_PROPERTY_TYPE.Time:
        return this.validateTime(value);
      case CHILL_PROPERTY_TYPE.DateTime:
        return this.validateDateTime(value);
      case CHILL_PROPERTY_TYPE.Duration:
        return this.validateDuration(value);
      case CHILL_PROPERTY_TYPE.Boolean:
        return typeof value === 'boolean' ? '' : this.chill.T('4EB9E8DC-FA6A-45A0-9C95-5814C44144F0', 'Invalid boolean value.', 'Valore booleano non valido.');
      case CHILL_PROPERTY_TYPE.String:
      case CHILL_PROPERTY_TYPE.Text:
        return this.validateString(value, property);
      case CHILL_PROPERTY_TYPE.ChillEntity:
      case CHILL_PROPERTY_TYPE.ChillQuery:
        return this.isJsonObject(value)
          ? ''
          : this.chill.T('5302E408-0D83-4857-8C81-17DCA0DDAF44', 'Select a value from the lookup results.', 'Seleziona un valore dai risultati di ricerca.');
      case CHILL_PROPERTY_TYPE.ChillEntityCollection:
        return Array.isArray(value) && value.every((item) => this.isJsonObject(item))
          ? ''
          : this.chill.T('5302E408-0D83-4857-8C81-17DCA0DDAF44', 'Select a value from the lookup results.', 'Seleziona un valore dai risultati di ricerca.');
      default:
        return '';
    }
  }

  private validateGuid(value: JsonValue | undefined): string {
    if (typeof value !== 'string') {
      return this.chill.T('514D6255-1A59-4D42-95B4-8BB5CFC7A04A', 'Invalid Guid value.', 'Valore Guid non valido.');
    }

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
      ? ''
      : this.chill.T('514D6255-1A59-4D42-95B4-8BB5CFC7A04A', 'Invalid Guid value.', 'Valore Guid non valido.');
  }

  private validateInteger(value: JsonValue | undefined, property: ChillPropertySchema): string {
    const numericValue = this.readNumber(value);
    if (numericValue === null || !Number.isInteger(numericValue)) {
      return this.chill.T('6574C416-B4C8-47D7-9936-A7AE1A0FC437', 'Enter a valid integer.', 'Inserisci un numero intero valido.');
    }

    return this.validateNumericRange(numericValue, property);
  }

  private validateDecimal(value: JsonValue | undefined, property: ChillPropertySchema): string {
    const numericValue = this.readNumber(value);
    if (numericValue === null) {
      return this.chill.T('4AE9D1D9-D3C5-42DB-BE55-0F322481A87B', 'Enter a valid decimal number.', 'Inserisci un numero decimale valido.');
    }

    return this.validateNumericRange(numericValue, property);
  }

  private validateNumericRange(value: number, property: ChillPropertySchema): string {
    const min = this.readMetadataNumber(property, 'min');
    if (min !== null && value < min) {
      return this.chill.T('52D0C7D3-D9DF-47F0-8752-A095BC307331', `Value must be greater than or equal to ${min}.`, `Il valore deve essere maggiore o uguale a ${min}.`);
    }

    const max = this.readMetadataNumber(property, 'max');
    if (max !== null && value > max) {
      return this.chill.T('DDF46D7D-4A1F-4510-9F8D-F77B3D96CF90', `Value must be less than or equal to ${max}.`, `Il valore deve essere minore o uguale a ${max}.`);
    }

    return '';
  }

  private validateDate(value: JsonValue | undefined): string {
    if (typeof value !== 'string') {
      return this.chill.T('8EC86C1D-B626-40FB-BEA8-1FE80B66E51F', 'Enter a valid date.', 'Inserisci una data valida.');
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? this.chill.T('8EC86C1D-B626-40FB-BEA8-1FE80B66E51F', 'Enter a valid date.', 'Inserisci una data valida.')
      : '';
  }

  private validateTime(value: JsonValue | undefined): string {
    if (typeof value !== 'string') {
      return this.chill.T('6E14B3A1-498E-4B11-A8C9-E16189E60AFD', 'Enter a valid time.', 'Inserisci un orario valido.');
    }

    return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,7})?)?$/.test(value.trim())
      ? ''
      : this.chill.T('6E14B3A1-498E-4B11-A8C9-E16189E60AFD', 'Enter a valid time.', 'Inserisci un orario valido.');
  }

  private validateDateTime(value: JsonValue | undefined): string {
    if (typeof value !== 'string') {
      return this.chill.T('B08EAAE2-7AA8-45C6-A531-0A37A4DE65F5', 'Enter a valid date and time.', 'Inserisci una data e ora valida.');
    }

    return this.parseDateTimeDisplayValue(value.trim()) === null
      ? this.chill.T('B08EAAE2-7AA8-45C6-A531-0A37A4DE65F5', 'Enter a valid date and time.', 'Inserisci una data e ora valida.')
      : '';
  }

  private validateDuration(value: JsonValue | undefined): string {
    if (typeof value !== 'string') {
      return this.chill.T('3DF867D5-F007-4D15-9579-0F6B6C7BA0EE', 'Enter a valid duration.', 'Inserisci una durata valida.');
    }

    return this.parseDurationDisplayValue(value.trim()) !== null
      ? ''
      : this.chill.T('3DF867D5-F007-4D15-9579-0F6B6C7BA0EE', 'Enter a valid duration.', 'Inserisci una durata valida.');
  }

  private validateString(value: JsonValue | undefined, property: ChillPropertySchema): string {
    if (typeof value !== 'string') {
      return this.chill.T('FAF662FD-D4D3-46C2-B052-8AA086B72ED2', 'Enter a valid text value.', 'Inserisci un valore testuale valido.');
    }

    const trimmedValue = value.trim();
    const minLength = this.readMetadataNumber(property, 'minLength');
    if (minLength !== null && trimmedValue.length < minLength) {
      return this.chill.T('CEC26B81-3B54-4B8A-A2C0-8136A7AA61A4', `Value must contain at least ${minLength} characters.`, `Il valore deve contenere almeno ${minLength} caratteri.`);
    }

    const maxLength = this.readMetadataNumber(property, 'maxLength');
    if (maxLength !== null && trimmedValue.length > maxLength) {
      return this.chill.T('A0382F9C-5F39-42BF-9B33-1B92ACDA25A1', `Value must contain at most ${maxLength} characters.`, `Il valore deve contenere al massimo ${maxLength} caratteri.`);
    }

    const pattern = property.metadata?.['pattern']?.trim();
    if (pattern && !(new RegExp(pattern).test(trimmedValue))) {
      return this.chill.T('D05267DD-7A9E-4099-B69B-D44B0EB23189', 'Value does not match the required format.', 'Il valore non rispetta il formato richiesto.');
    }

    return '';
  }

  private normalizeBlurValue(property: ChillPropertySchema, value: string): JsonValue | null {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      return '';
    }

    switch (property.propertyType) {
      case CHILL_PROPERTY_TYPE.Integer: {
        const numericValue = Number(trimmedValue);
        return Number.isInteger(numericValue)
          ? numericValue
          : null;
      }
      case CHILL_PROPERTY_TYPE.Decimal: {
        const numericValue = Number(trimmedValue);
        return Number.isFinite(numericValue)
          ? numericValue
          : null;
      }
      case CHILL_PROPERTY_TYPE.Date:
        return this.parseDateDisplayValue(trimmedValue);
      case CHILL_PROPERTY_TYPE.Time:
        return this.parseTimeDisplayValue(trimmedValue);
      case CHILL_PROPERTY_TYPE.DateTime:
        return this.parseDateTimeDisplayValue(trimmedValue);
      case CHILL_PROPERTY_TYPE.Duration:
        return this.parseDurationDisplayValue(trimmedValue);
      default:
        return trimmedValue;
    }
  }

  private parseDateDisplayValue(value: string): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const day = `${parsed.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseTimeDisplayValue(value: string): string | null {
    const match = value.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(\.\d{1,7})?)?$/);
    if (!match) {
      return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] ? Number(match[3]) : null;
    const fractional = match[4] ?? '';

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || (seconds !== null && (seconds < 0 || seconds > 59))) {
      return null;
    }

    const normalizedHours = `${hours}`.padStart(2, '0');
    const normalizedMinutes = `${minutes}`.padStart(2, '0');
    if (seconds === null) {
      return `${normalizedHours}:${normalizedMinutes}`;
    }

    return `${normalizedHours}:${normalizedMinutes}:${`${seconds}`.padStart(2, '0')}${fractional}`;
  }

  private parseDateTimeDisplayValue(value: string): string | null {
    const directMatch = value.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?(Z|[+-]\d{2}:\d{2})?$/
    );
    if (directMatch) {
      const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, offsetText] = directMatch;
      const year = Number(yearText);
      const month = Number(monthText);
      const day = Number(dayText);
      const hour = Number(hourText);
      const minute = Number(minuteText);
      const second = secondText ? Number(secondText) : 0;

      if (!this.isValidDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) {
        return null;
      }

      const normalizedDate = `${yearText}-${monthText}-${dayText}`;
      const normalizedTime = `${`${hour}`.padStart(2, '0')}:${minuteText}:${`${second}`.padStart(2, '0')}`;
      return `${normalizedDate}T${normalizedTime}${fractionText ?? ''}${offsetText ?? ''}`;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    const year = parsed.getFullYear();
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const day = `${parsed.getDate()}`.padStart(2, '0');
    const hour = `${parsed.getHours()}`.padStart(2, '0');
    const minute = `${parsed.getMinutes()}`.padStart(2, '0');
    const second = `${parsed.getSeconds()}`.padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }

  private parseDurationDisplayValue(value: string): string | null {
    if (/^P(?!$)(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?$/i.test(value)) {
      return value.toUpperCase();
    }

    const match = value.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{1,2})(?::(\d{1,2})(\.\d{1,7})?)?$/);
    if (!match) {
      return null;
    }

    const days = match[1] ? Number(match[1]) : null;
    const hours = Number(match[2]);
    const minutes = Number(match[3]);
    const seconds = match[4] ? Number(match[4]) : null;
    const fractional = match[5] ?? '';
    if ((days !== null && days < 0) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || (seconds !== null && (seconds < 0 || seconds > 59))) {
      return null;
    }

    const normalizedHours = `${hours}`.padStart(2, '0');
    const normalizedMinutes = `${minutes}`.padStart(2, '0');
    const dayPrefix = days !== null ? `${days}.` : '';
    if (seconds === null) {
      return `${dayPrefix}${normalizedHours}:${normalizedMinutes}`;
    }

    return `${dayPrefix}${normalizedHours}:${normalizedMinutes}:${`${seconds}`.padStart(2, '0')}${fractional}`;
  }

  private isValidDateParts(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }

    const candidate = new Date(year, month - 1, day);
    return candidate.getFullYear() === year
      && candidate.getMonth() === month - 1
      && candidate.getDate() === day;
  }

  private readMetadataNumber(property: ChillPropertySchema, key: string): number | null {
    const rawValue = property.metadata?.[key]?.trim();
    if (!rawValue) {
      return null;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue)
      ? parsedValue
      : null;
  }

  private isRequired(property: ChillPropertySchema): boolean {
    const rawRequired = property.metadata?.['required']?.trim().toLowerCase();
    return rawRequired === 'true'
      || rawRequired === '1'
      || rawRequired === 'required';
  }

  private isEmptyValue(value: JsonValue | undefined): boolean {
    if (value === undefined || value === null) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return false;
  }

  private readNumber(value: JsonValue | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim()) {
      const parsedValue = Number(value);
      return Number.isFinite(parsedValue)
        ? parsedValue
        : null;
    }

    return null;
  }

  private shouldSkipProperty(property: ChillPropertySchema): boolean {
    return property.propertyType === CHILL_PROPERTY_TYPE.Unknown;
  }

  private extractLookupResults(response: JsonObject): JsonObject[] {
    const candidates = [
      response,
      response['Results'],
      response['Entities'],
      response['Items'],
      response['Value'],
      response['Data']
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      const results = candidate.filter((item): item is JsonObject => this.isJsonObject(item));
      if (results.length > 0) {
        return results;
      }
    }

    return [];
  }

  private setLookupError(propertyName: string, message: string, preserveResults = true): void {
    this.lookups.update((current) => ({
      ...current,
      [propertyName]: {
        ...(current[propertyName] ?? this.createEmptyLookupState()),
        isSearching: false,
        error: message,
        results: preserveResults ? (current[propertyName]?.results ?? []) : []
      }
    }));
  }

  private createEmptyLookupState(): LookupState {
    return {
      term: '',
      isSearching: false,
      error: '',
      results: [],
      selectedGuid: ''
    };
  }

  private scheduleLookupSearch(property: ChillPropertySchema, term: string): void {
    this.cancelLookupSearch(property.name);
    this.lookupSearchTimers.set(property.name, setTimeout(() => {
      this.lookupSearchTimers.delete(property.name);
      this.searchLookup(property, term);
    }, 220));
  }

  private cancelLookupSearch(propertyName: string): void {
    const timer = this.lookupSearchTimers.get(propertyName);
    if (timer) {
      clearTimeout(timer);
      this.lookupSearchTimers.delete(propertyName);
    }
  }

  private matchesLookupLabel(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private notifyFieldBlur(propertyName: string): void {
    this.fieldBlur.emit({
      [propertyName]: this.fieldValues()[propertyName]
    });
  }

  private setFieldValue(propertyName: string, value: JsonValue): void {
    const control = this.control(propertyName);
    control?.setValue(value);
    this.fieldValues.update((current) => ({
      ...current,
      [propertyName]: value
    }));
  }

  private syncLookupState(property: ChillPropertySchema, value: JsonValue): void {
    if (!this.isLookup(property) && !this.isLookupCollection(property)) {
      return;
    }

    this.lookups.update((current) => ({
      ...current,
      [property.name]: {
        ...(current[property.name] ?? this.createEmptyLookupState()),
        term: this.isLookupCollection(property)
          ? this.lookupCollectionSummaryFromValue(value)
          : this.isJsonObject(value) ? this.lookupLabel(value) : (current[property.name]?.term ?? ''),
        selectedGuid: this.isJsonObject(value) ? this.lookupGuid(value) : ''
      }
    }));
  }

  private lookupCollectionSummaryFromValue(value: JsonValue): string {
    return Array.isArray(value)
      ? value.filter((item): item is JsonObject => this.isJsonObject(item)).map((item) => this.lookupLabel(item)).filter((item) => item.length > 0).join(', ')
      : '';
  }

  private toPascalCase(value: string): string {
    return value.length > 0
      ? `${value[0].toUpperCase()}${value.slice(1)}`
      : value;
  }

  private isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private areRecordsEqual(left: FieldValueMap, right: FieldValueMap): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => Object.is(left[key], right[key]));
  }

  private areStringRecordsEqual(left: ErrorMap, right: ErrorMap): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => left[key] === right[key]);
  }

  private areLookupStatesEqual(
    left: Record<string, LookupState>,
    right: Record<string, LookupState>
  ): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => this.areLookupStateEntriesEqual(left[key], right[key]));
  }

  private areLookupStateEntriesEqual(left: LookupState | undefined, right: LookupState | undefined): boolean {
    if (!left || !right) {
      return left === right;
    }

    return left.term === right.term
      && left.isSearching === right.isSearching
      && left.error === right.error
      && left.results.length === right.results.length
      && left.results.every((item, index) => item === right.results[index]);
  }
}
