import type { ChillPropertySelectOptionTuple } from '../models/chill-schema.models';

const STANDARD_CULTURE_NAMES = [
  'it-IT',
  'en-GB',
  'en-US',
  'fr-FR',
  'de-DE',
  'es-ES',
  'pt-PT',
  'pt-BR',
  'nl-NL',
  'sv-SE',
  'da-DK',
  'nb-NO',
  'fi-FI',
  'pl-PL',
  'cs-CZ',
  'sk-SK',
  'hu-HU',
  'ro-RO',
  'el-GR',
  'tr-TR',
  'ru-RU',
  'uk-UA',
  'ar-SA',
  'he-IL',
  'hi-IN',
  'th-TH',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR'
];

export function getCultureNameOptions(): ChillPropertySelectOptionTuple[] {
  return STANDARD_CULTURE_NAMES
    .map((cultureName) => [cultureName, cultureName] as ChillPropertySelectOptionTuple);
}
