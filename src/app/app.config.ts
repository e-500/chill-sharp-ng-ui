import { ApplicationConfig, inject, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { CHILL_SHARP_CLIENT, ChillSharpNgClient, provideChillSharpClient } from 'chill-sharp-ng-client';

import { CHILL_BASE_URL, CHILL_CULTURE } from './chill.config';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    ...provideChillSharpClient({
      baseUrl: CHILL_BASE_URL,
      options: {
        cultureName: CHILL_CULTURE,
        accessToken: readStoredAccessToken(),
        fetchImpl: authAwareFetch
      }
    }),
    {
      provide: ChillSharpNgClient,
      useFactory: () => new ChillSharpNgClient(inject(CHILL_SHARP_CLIENT))
    }
  ]
};

async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const accessToken = readStoredAccessToken();
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  return globalThis.fetch(input, {
    ...init,
    headers
  });
}

function readStoredAccessToken(): string {
  const rawSession = globalThis.localStorage?.getItem('cini-home.chill-auth-session');
  if (!rawSession) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawSession) as { accessToken?: string };
    return parsed.accessToken?.trim() ?? '';
  } catch {
    return '';
  }
}
