const DEBUG_CHILL_BASE_URL = 'http://localhost:6002/api/chill';

export const CHILL_BASE_URL = normalizeChillBaseUrl(globalThis.CHILLSHARP_API_URL?.trim() || DEBUG_CHILL_BASE_URL);
export const CHILL_CULTURE = 'it-IT';
export const CHILL_PRIMARY_TEXT_CULTURE = 'en-US';
export const CHILL_SECONDARY_TEXT_CULTURE = 'it-IT';

function normalizeChillBaseUrl(value: string): string {
  const normalizedValue = value.replace(/\/+$/, '');
  if (normalizedValue.toLowerCase().endsWith('/chill')) {
    return normalizedValue;
  }

  return `${normalizedValue}/chill`;
}
