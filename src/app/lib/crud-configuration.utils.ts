import type { JsonValue } from 'chill-sharp-ng-client';
import type { ChillSchema, ChillSchemaRelation, ChillSchemaRelationLabel } from '../models/chill-schema.models';

export function applySchemaRelationsToCrudConfiguration(
  baseConfiguration: Record<string, unknown>,
  schema: ChillSchema | null
): Record<string, unknown> {
  return {
    ...baseConfiguration,
    relations: buildCrudRelationsFromSchema(schema)
  };
}

export function buildCrudRelationsFromSchema(schema: ChillSchema | null): Record<string, unknown>[] {
  if (!schema || !Array.isArray(schema.relations)) {
    return [];
  }

  return schema.relations
    .map((relation) => mapSchemaRelationToCrudConfiguration(relation))
    .filter((relation): relation is Record<string, unknown> => relation !== null);
}

function mapSchemaRelationToCrudConfiguration(relation: ChillSchemaRelation): Record<string, unknown> | null {
  const chillType = normalizeString(relation.chillType);
  if (!chillType) {
    return null;
  }

  const configuration: Record<string, unknown> = {
    chillType
  };

  const chillQuery = normalizeString(relation.chillQuery);
  if (chillQuery) {
    configuration['chillQuery'] = chillQuery;
  }

  const fixedValues = normalizeJsonRecord(relation.fixedValues);
  if (Object.keys(fixedValues).length > 0) {
    configuration['fixedValues'] = fixedValues;
  }

  const fixedQueryValues = normalizeJsonRecord(relation.fixedQueryValues);
  if (Object.keys(fixedQueryValues).length > 0) {
    configuration['fixedQueryValues'] = fixedQueryValues;
  }

  const relationLabel = mapRelationLabel(relation.relationLabel);
  if (relationLabel) {
    configuration['relationLabel'] = relationLabel;
  }

  return configuration;
}

function mapRelationLabel(relationLabel: ChillSchemaRelationLabel | null | undefined): Record<string, string> | null {
  if (!relationLabel) {
    return null;
  }

  const labelGuid = normalizeString(relationLabel.labelGuid);
  const primaryDefaultText = normalizeString(relationLabel.primaryDefaultText);
  const secondaryDefaultText = normalizeString(relationLabel.secondaryDefaultText);
  if (!labelGuid || !primaryDefaultText || !secondaryDefaultText) {
    return null;
  }

  return {
    labelGuid,
    primaryDefaultText,
    secondaryDefaultText
  };
}

function normalizeJsonRecord(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key.trim(), entryValue] as const)
      .filter(([key]) => key.length > 0)
  );
}

function normalizeString(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}
