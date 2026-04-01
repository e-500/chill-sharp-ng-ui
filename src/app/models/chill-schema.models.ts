import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';

export type ChillEntityState = JsonObject & {
  isNew?: boolean;
  isDeleting?: boolean;
};

export interface ChillPropertySchema {
  name: string;
  displayName?: string;
  propertyType?: number;
  isNullable: boolean;
  chillType?: string | null;
  dateFormat?: string;
  customFormat?: string;
  metadata?: Record<string, string>;
}

export interface ChillSchema {
  chillType?: string;
  chillViewCode?: string;
  displayName?: string;
  queryRelatedChillType?: string;
  metadata?: Record<string, string>;
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
  ChillEntity: 1000,
  ChillEntityCollection: 1010,
  ChillQuery: 1100
} as const;

export type ChillEntityStatus = 'pristine' | 'draft' | 'dirty' | 'saving' | 'deleted' | 'error';

export type ChillState = JsonObject & {
  isNew: boolean;
  status: ChillEntityStatus;
  errorMessage?: string | null;
  validationErrors?: Record<string, string> | null;
  genericErrors?: string[] | null;
  dirtyProperties?: string[] | null;
};
