import { InjectionToken, type Provider } from '@angular/core';
import { ChillSharpClient, type ChillSharpClientOptions } from 'chill-sharp-ts-client';

export interface ChillSharpNgOptions {
  baseUrl: string;
  client?: ChillSharpClient;
  options?: ChillSharpClientOptions;
}

export const CHILL_SHARP_CLIENT = new InjectionToken<ChillSharpClient>('CHILL_SHARP_CLIENT');

export function createChillSharpClient(config: ChillSharpNgOptions): ChillSharpClient {
  if (config.client) {
    return config.client;
  }

  return new ChillSharpClient(config.baseUrl, config.options);
}

export function provideChillSharpClient(config: ChillSharpNgOptions): Provider[] {
  const client = createChillSharpClient(config);
  return [
    {
      provide: CHILL_SHARP_CLIENT,
      useValue: client
    }
  ];
}
