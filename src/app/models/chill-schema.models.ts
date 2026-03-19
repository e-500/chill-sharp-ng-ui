import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';

export interface ChillPropertySchema {
  name: string;
  displayName?: string;
  dateFormat?: string;
  customFormat?: string;
  metadata?: Record<string, string>;
}

export interface ChillSchema {
  chillType?: string;
  chillViewCode?: string;
  displayName?: string;
  queryRelatedChillType?: string;
  properties: ChillPropertySchema[];
}

export interface ChillSchemaListItem {
  name: string;
  chillType: string;
  type?: string;
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
};

export type ChillQuery = JsonObject & {
  chillType?: string;
  properties?: Record<string, JsonValue>;
  resultProperties?: JsonValue[];
};

export interface ChillFormSubmitEvent {
  kind: 'entity' | 'query';
  value: ChillEntity | ChillQuery;
}
