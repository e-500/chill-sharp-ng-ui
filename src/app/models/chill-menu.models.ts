import type { JsonObject } from 'chill-sharp-ng-client';

export interface ChillMenuItem extends JsonObject {
  guid: string;
  title: string;
  description: string | null;
  parent: ChillMenuItem | null;
  componentName: string;
  componentConfigurationJson: string | null;
  menuHierarchy: string;
}

