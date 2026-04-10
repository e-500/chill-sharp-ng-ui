import { APP_INITIALIZER, ApplicationConfig, inject, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { CHILL_SHARP_CLIENT, ChillSharpNgClient, provideChillSharpClient } from 'chill-sharp-ng-client';

import { CHILL_BASE_URL, CHILL_CULTURE } from './chill.config';
import { routes } from './app.routes';
import { ChillService } from './services/chill.service';
import { WorkspaceTaskRegistryService } from './services/workspace-task-registry.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    ...provideChillSharpClient({
      baseUrl: CHILL_BASE_URL,
      options: {
        cultureName: readStoredCultureName(),
        accessToken: readStoredAccessToken(),
        fetchImpl: authAwareFetch,
        signalRWithCredentials: false
      }
    }),
    {
      provide: ChillSharpNgClient,
      useFactory: () => new ChillSharpNgClient(inject(CHILL_SHARP_CLIENT))
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => () => inject(WorkspaceTaskRegistryService).initialize()
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => () => inject(ChillService).initialize()
    }
  ]
};

async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  const accessToken = readStoredAccessToken();
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let effectiveMethod = method;

  if (shouldRewriteI18nBodyRequest(requestUrl, method, init?.body)) {
    effectiveMethod = 'POST';
  }

  return globalThis.fetch(input, {
    ...init,
    method: effectiveMethod,
    headers
  });
}

function shouldRewriteI18nBodyRequest(url: string, method: string, body: BodyInit | null | undefined): boolean {
  if (method !== 'GET' || body == null) {
    return false;
  }

  return url.includes('/api/chill-i18n/get-text') || url.includes('/api/chill-i18n/get-multiple-text');
}

function readStoredAccessToken(): string {
  const rawSession = globalThis.localStorage?.getItem('chill-sharp-ng-ui.chill-auth-session');
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

function readStoredCultureName(): string {
  const rawPreferences = globalThis.localStorage?.getItem('chill-sharp-ng-ui.user-preferences');
  if (!rawPreferences) {
    return CHILL_CULTURE;
  }

  try {
    const parsed = JSON.parse(rawPreferences) as { displayCultureName?: string };
    return parsed.displayCultureName?.trim() || CHILL_CULTURE;
  } catch {
    return CHILL_CULTURE;
  }
}
