import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideChillSharpClient } from 'chill-sharp-ng-client';

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
        accessToken: readStoredAccessToken()
      }
    })
  ]
};

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
