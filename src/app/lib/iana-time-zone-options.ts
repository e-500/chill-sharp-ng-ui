import type { ChillPropertySelectOptionTuple } from '../models/chill-schema.models';

const FALLBACK_IANA_TIME_ZONES: string[] = [
  'UTC',
  'Europe/London',
  'Europe/Rome',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Athens',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney'
];

export function getIanaTimeZoneOptions(): ChillPropertySelectOptionTuple[] {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf;
  const timeZones = typeof supportedValuesOf === 'function'
    ? supportedValuesOf('timeZone')
    : FALLBACK_IANA_TIME_ZONES;

  return [...new Set(timeZones)]
    .filter((timeZone) => typeof timeZone === 'string' && timeZone.trim().length > 0)
    .sort((left, right) => left.localeCompare(right))
    .map((timeZone) => [timeZone, timeZone] as ChillPropertySelectOptionTuple);
}
