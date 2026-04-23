import type { ChillDtoEntityOptions, JsonObject, JsonValue } from 'chill-sharp-ng-client';

export type ChillMetadataValue = JsonValue;
export type ChillPropertySelectOptionTuple = [value: string, text: string];
export type ChillMetadataRecord = Record<string, ChillMetadataValue>;

export interface ChillSchemaRelationLabel {
  labelGuid?: string | null;
  primaryDefaultText?: string;
  secondaryDefaultText?: string;
}

export interface ChillSchemaRelation {
  chillType?: string;
  chillQuery?: string;
  fixedValues?: Record<string, JsonValue>;
  fixedQueryValues?: Record<string, JsonValue>;
  relationLabel?: ChillSchemaRelationLabel | null;
}

export type ChillEntityState = JsonObject & {
  isNew?: boolean;
  isDeleting?: boolean;
};

export interface ChillPropertySchema {
  name: string;
  displayName?: string;
  propertyType?: number;
  simplePropertyType?: string;
  mcpDescription?: string;
  isNullable: boolean;
  isReadOnly?: boolean;
  chillType?: string | null;
  referenceChillType?: string | null;
  referenceChillTypeQuery?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  integerMinValue?: number | null;
  integerMaxValue?: number | null;
  decimalMinValue?: number | null;
  decimalMaxValue?: number | null;
  decimalPlaces?: number | null;
  precision?: number | null;
  scale?: number | null;
  dateFormat?: string;
  customFormat?: string;
  regexPattern?: string;
  enumValues?: string[] | null;
  metadata?: ChillMetadataRecord;
}

export interface ChillSchema {
  chillType?: string;
  chillViewCode?: string;
  displayName?: string;
  handleAttachments?: boolean;
  enableMCP?: boolean;
  mcpDescription?: string | null;
  queryRelatedChillType?: string;
  metadata?: ChillMetadataRecord;
  relations?: ChillSchemaRelation[];
  properties: ChillPropertySchema[];
}

export interface ChillSchemaListItem {
  name: string;
  chillType: string;
  type?: string;
  displayName?: string;
  chillViewCode?: string;
  module?: string;
  relatedChillType?: string | null;
}

export interface ChillEntityOptions extends ChillDtoEntityOptions {
  enableMCP: boolean;
  mcpDescription: string | null;
}

export interface ChillOrdering extends JsonObject {
  propertyName: string;
  direction: 'ASC' | 'DESC';
}

export interface ChillPagination extends JsonObject {
  Page: number;
  PageResults: number;
}

export type ChillEntityChangeAction = 'CREATED' | 'UPDATED' | 'DELETED';

export interface ChillEntityChangeNotification {
  chillType: string;
  guid: string;
  action: ChillEntityChangeAction;
}

export type ChillEntity = JsonObject & {
  guid?: string;
  label?: string;
  properties?: Record<string, JsonValue>;
  chillState?: ChillEntityState;
};

export type ChillQuery = JsonObject & {
  chillType?: string;
  properties?: Record<string, JsonValue>;
  resultProperties?: JsonValue[];
  pagination?: ChillPagination | null;
  ordering?: ChillOrdering | null;
  chillState?: ChillEntityState;
};

export interface ChillFormSubmitEvent {
  kind: 'entity' | 'query';
  value: ChillEntity | ChillQuery;
}

export const CHILL_PROPERTY_TYPE = {
  Unknown: 0,
  Guid: 1,
  Integer: 10,
  Decimal: 20,
  Date: 30,
  Time: 40,
  DateTime: 50,
  Duration: 60,
  Boolean: 70,
  String: 80,
  Text: 81,
  Select: 90,
  Json: 99,
  ChillEntity: 1000,
  ChillEntityCollection: 1010,
  ChillQuery: 1100
} as const;

export type ChillPropertyTypeOption = {
  value: number;
  label: string;
};

export const CHILL_PROPERTY_TYPE_OPTIONS: ChillPropertyTypeOption[] = [
  { value: CHILL_PROPERTY_TYPE.Guid, label: 'Guid' },
  { value: CHILL_PROPERTY_TYPE.Integer, label: 'Integer' },
  { value: CHILL_PROPERTY_TYPE.Decimal, label: 'Decimal' },
  { value: CHILL_PROPERTY_TYPE.Date, label: 'Date' },
  { value: CHILL_PROPERTY_TYPE.Time, label: 'Time' },
  { value: CHILL_PROPERTY_TYPE.DateTime, label: 'DateTime' },
  { value: CHILL_PROPERTY_TYPE.Duration, label: 'Duration' },
  { value: CHILL_PROPERTY_TYPE.Boolean, label: 'Boolean' },
  { value: CHILL_PROPERTY_TYPE.String, label: 'String' },
  { value: CHILL_PROPERTY_TYPE.Text, label: 'Text' },
  { value: CHILL_PROPERTY_TYPE.Select, label: 'Select' },
  { value: CHILL_PROPERTY_TYPE.Json, label: 'Json' },
  { value: CHILL_PROPERTY_TYPE.ChillEntity, label: 'ChillEntity' },
  { value: CHILL_PROPERTY_TYPE.ChillEntityCollection, label: 'ChillEntityCollection' },
  { value: CHILL_PROPERTY_TYPE.ChillQuery, label: 'ChillQuery' }
];

export function canChangeChillPropertyType(currentType: number | undefined, nextType: number): boolean {
  if ((currentType ?? CHILL_PROPERTY_TYPE.Unknown) === nextType) {
    return true;
  }

  return currentType === CHILL_PROPERTY_TYPE.String
    && (nextType === CHILL_PROPERTY_TYPE.Text || nextType === CHILL_PROPERTY_TYPE.Json);
}

export function chillSimplePropertyType(propertyType: number | undefined): string {
  switch (propertyType) {
    case CHILL_PROPERTY_TYPE.Guid:
      return 'guid';
    case CHILL_PROPERTY_TYPE.Integer:
      return 'int';
    case CHILL_PROPERTY_TYPE.Decimal:
      return 'decimal';
    case CHILL_PROPERTY_TYPE.Date:
      return 'date';
    case CHILL_PROPERTY_TYPE.Time:
      return 'time';
    case CHILL_PROPERTY_TYPE.DateTime:
      return 'datetime';
    case CHILL_PROPERTY_TYPE.Duration:
      return 'duration';
    case CHILL_PROPERTY_TYPE.Boolean:
      return 'bool';
    case CHILL_PROPERTY_TYPE.String:
      return 'string';
    case CHILL_PROPERTY_TYPE.Text:
      return 'text';
    case CHILL_PROPERTY_TYPE.Select:
      return 'string';
    case CHILL_PROPERTY_TYPE.Json:
      return 'json';
    case CHILL_PROPERTY_TYPE.ChillEntity:
      return 'chill-entity';
    case CHILL_PROPERTY_TYPE.ChillEntityCollection:
      return 'chill-entity-collection';
    case CHILL_PROPERTY_TYPE.ChillQuery:
      return 'chill-query';
    default:
      return '';
  }
}

export type ChillEntityStatus = 'pristine' | 'draft' | 'dirty' | 'saving' | 'deleted' | 'error';

export type ChillState = JsonObject & {
  isNew: boolean;
  status: ChillEntityStatus;
  errorMessage?: string | null;
  validationErrors?: Record<string, string> | null;
  genericErrors?: string[] | null;
  dirtyProperties?: string[] | null;
  ignoreNotificationsUntil?: number | null;
};
