import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { EventViewerComponent } from '../pages/atlas/event-viewer/event-viewer.component';
import { PermissionsPageComponent } from '../pages/permissions/permissions-page.component';
import { CrudTaskComponent } from '../tasks/crud-task/crud-task.component';
import type {
  WorkspaceFederationContainer,
  WorkspaceRemoteTaskDefinition,
  WorkspaceTaskComponentType,
  WorkspaceTaskRuntimeConfig,
  WorkspaceTaskSourceIndex
} from '../models/workspace-task.models';

export interface WorkspaceTaskDefinition {
  componentName: string;
  title: string;
  description: string;
  kind: 'builtin' | 'remote';
  showInQuickLaunch: boolean;
  loadComponent: () => Promise<WorkspaceTaskComponentType>;
}

interface WorkspaceTaskDefinitionRecord extends WorkspaceTaskDefinition {
  aliases: string[];
}

const DEFAULT_SOURCE_INDEX_FILE = 'workspace-tasks.index.json';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceTaskRegistryService {
  private readonly document = inject(DOCUMENT);

  private readonly definitionsState = signal<WorkspaceTaskDefinitionRecord[]>([]);
  private readonly initializationErrorState = signal('');
  private readonly remoteEntryLoads = new Map<string, Promise<void>>();
  private readonly remoteComponentLoads = new Map<string, Promise<WorkspaceTaskComponentType>>();
  private initialized = false;

  readonly definitions = computed<WorkspaceTaskDefinition[]>(() => this.definitionsState()
    .map(({ aliases: _aliases, ...definition }) => definition));
  readonly initializationError = this.initializationErrorState.asReadonly();

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.registerBuiltInTasks();

    try {
      await this.loadRemoteTaskSources();
    } catch (error) {
      this.initializationErrorState.set(error instanceof Error ? error.message : 'Unable to initialize workspace task sources.');
      console.error(error);
    }
  }

  getTaskDefinition(componentName: string): WorkspaceTaskDefinition | null {
    const normalizedName = normalizeComponentName(componentName);
    return this.definitionsState().find((definition) => definition.aliases.includes(normalizedName)) ?? null;
  }

  async resolveComponent(componentName: string): Promise<WorkspaceTaskComponentType | null> {
    const definition = this.getTaskDefinition(componentName);
    if (!definition) {
      return null;
    }

    return definition.loadComponent();
  }

  private registerBuiltInTasks(): void {
    this.registerDefinition({
      componentName: 'event-viewer',
      title: 'Event Viewer',
      description: 'Browse event stream data.',
      kind: 'builtin',
      showInQuickLaunch: true,
      loadComponent: async () => EventViewerComponent,
      aliases: ['event-viewer', 'eventviewer', 'events']
    });

    this.registerDefinition({
      componentName: 'permissions',
      title: 'Permissions',
      description: 'Manage roles, users, and access rules.',
      kind: 'builtin',
      showInQuickLaunch: false,
      loadComponent: async () => PermissionsPageComponent,
      aliases: ['permissions', 'permission', 'permission-page']
    });

    this.registerDefinition({
      componentName: 'crud',
      title: 'CRUD',
      description: 'Inspect schemas and work with entities.',
      kind: 'builtin',
      showInQuickLaunch: false,
      loadComponent: async () => CrudTaskComponent,
      aliases: ['crud']
    });
  }

  private async loadRemoteTaskSources(): Promise<void> {
    const runtimeConfig = readWorkspaceRuntimeConfig();
    const sourceUrls = normalizeSourceUrls(runtimeConfig.workspaceTaskSources ?? []);
    if (sourceUrls.length === 0) {
      return;
    }

    const sourceResults = await Promise.all(sourceUrls.map(async (sourceUrl) => {
      const response = await globalThis.fetch(resolveSourceIndexUrl(sourceUrl));
      if (!response.ok) {
        throw new Error(`Unable to load workspace task index from ${sourceUrl}.`);
      }

      const index = await response.json() as WorkspaceTaskSourceIndex;
      return { sourceUrl, index };
    }));

    for (const { sourceUrl, index } of sourceResults) {
      for (const task of index.tasks ?? []) {
        this.registerRemoteTask(sourceUrl, task);
      }
    }
  }

  private registerRemoteTask(sourceUrl: string, task: WorkspaceRemoteTaskDefinition): void {
    const componentName = task.componentName?.trim();
    if (!componentName) {
      return;
    }

    const remoteEntryUrl = new URL(task.remoteEntry, ensureTrailingSlash(sourceUrl)).toString();
    const remoteName = task.remoteName?.trim();
    const exposedModule = task.exposedModule?.trim();
    if (!remoteName || !exposedModule) {
      return;
    }

    const cacheKey = [
      remoteEntryUrl,
      remoteName,
      exposedModule,
      task.exportedComponentName?.trim() || 'default'
    ].join('::');

    this.registerDefinition({
      componentName,
      title: task.title?.trim() || componentName,
      description: task.description?.trim() || 'External workspace task.',
      kind: 'remote',
      showInQuickLaunch: Boolean(task.showInQuickLaunch),
      loadComponent: () => this.loadRemoteComponent(cacheKey, remoteEntryUrl, remoteName, exposedModule, task.exportedComponentName?.trim() || 'default'),
      aliases: [componentName]
    });
  }

  private registerDefinition(definition: WorkspaceTaskDefinitionRecord): void {
    const normalizedAliases = [...new Set(definition.aliases.map((alias) => normalizeComponentName(alias)).filter(Boolean))];
    if (normalizedAliases.length === 0) {
      return;
    }

    this.definitionsState.update((definitions) => {
      if (definitions.some((current) => normalizedAliases.some((alias) => current.aliases.includes(alias)))) {
        console.warn(`Skipping duplicate workspace task registration for "${definition.componentName}".`);
        return definitions;
      }

      return [...definitions, {
        ...definition,
        aliases: normalizedAliases
      }];
    });
  }

  private loadRemoteComponent(
    cacheKey: string,
    remoteEntryUrl: string,
    remoteName: string,
    exposedModule: string,
    exportedComponentName: string
  ): Promise<WorkspaceTaskComponentType> {
    const existingLoad = this.remoteComponentLoads.get(cacheKey);
    if (existingLoad) {
      return existingLoad;
    }

    const load = (async () => {
      await this.ensureRemoteEntry(remoteEntryUrl);
      const container = readFederationContainer(remoteName);
      if (!container) {
        throw new Error(`Remote container "${remoteName}" is not available after loading ${remoteEntryUrl}.`);
      }

      await initializeFederationContainer(container);
      const moduleFactory = await container.get(exposedModule);
      const moduleExports = moduleFactory();
      const component = readExportedComponent(moduleExports, exportedComponentName);
      if (!component) {
        throw new Error(`Remote task "${remoteName}/${exposedModule}" did not export component "${exportedComponentName}".`);
      }

      return component;
    })();

    this.remoteComponentLoads.set(cacheKey, load);
    return load;
  }

  private ensureRemoteEntry(remoteEntryUrl: string): Promise<void> {
    const existingLoad = this.remoteEntryLoads.get(remoteEntryUrl);
    if (existingLoad) {
      return existingLoad;
    }

    const load = new Promise<void>((resolve, reject) => {
      const script = this.document.createElement('script');
      script.type = 'text/javascript';
      script.src = remoteEntryUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Unable to load remote entry ${remoteEntryUrl}.`));
      this.document.head.appendChild(script);
    });

    this.remoteEntryLoads.set(remoteEntryUrl, load);
    return load;
  }
}

function normalizeComponentName(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSourceUrls(sourceUrls: string[]): string[] {
  return sourceUrls
    .map((sourceUrl) => sourceUrl.trim())
    .filter(Boolean);
}

function resolveSourceIndexUrl(sourceUrl: string): string {
  return sourceUrl.toLowerCase().endsWith('.json')
    ? sourceUrl
    : `${ensureTrailingSlash(sourceUrl)}${DEFAULT_SOURCE_INDEX_FILE}`;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function readWorkspaceRuntimeConfig(): WorkspaceTaskRuntimeConfig {
  return globalThis.__ciniHomeRuntimeConfig__ ?? {};
}

function readFederationContainer(remoteName: string): WorkspaceFederationContainer | null {
  const container = (globalThis as Record<string, unknown>)[remoteName];
  if (!container || typeof container !== 'object') {
    return null;
  }

  return container as WorkspaceFederationContainer;
}

async function initializeFederationContainer(container: WorkspaceFederationContainer): Promise<void> {
  if (typeof container.init !== 'function') {
    return;
  }

  const globalScope = globalThis as typeof globalThis & {
    __webpack_init_sharing__?: (scope: string) => Promise<void>;
    __webpack_share_scopes__?: Record<string, unknown>;
  };

  if (typeof globalScope.__webpack_init_sharing__ === 'function') {
    await globalScope.__webpack_init_sharing__('default');
    await container.init(globalScope.__webpack_share_scopes__?.['default'] ?? {});
    return;
  }

  await container.init({});
}

function readExportedComponent(moduleExports: unknown, exportedComponentName: string): WorkspaceTaskComponentType | null {
  if (!moduleExports || typeof moduleExports !== 'object') {
    return null;
  }

  const exportsRecord = moduleExports as Record<string, unknown>;
  const namedExport = exportsRecord[exportedComponentName];
  if (isAngularComponentType(namedExport)) {
    return namedExport;
  }

  const defaultExport = exportsRecord['default'];
  return isAngularComponentType(defaultExport) ? defaultExport : null;
}

function isAngularComponentType(value: unknown): value is WorkspaceTaskComponentType {
  return typeof value === 'function';
}
