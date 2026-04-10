import type { ChillPropertySelectOptionTuple } from '../models/chill-schema.models';

const DATE_FORMAT_OPTIONS: ReadonlyArray<ChillPropertySelectOptionTuple> = [
  ['dd/MM/yyyy', 'dd/MM/yyyy'],
  ['MM/dd/yyyy', 'MM/dd/yyyy'],
  ['yyyy-MM-dd', 'yyyy-MM-dd'],
  ['DD/MM/YYYY', 'DD/MM/YYYY'],
  ['MM/DD/YYYY', 'MM/DD/YYYY'],
  ['YYYY-MM-DD', 'YYYY-MM-DD']
];

export function getDateFormatOptions(): ChillPropertySelectOptionTuple[] {
  return [...DATE_FORMAT_OPTIONS];
}
