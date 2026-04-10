import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { CrudTaskComponent } from '../tasks/crud-task/crud-task.component';
import type { ChillMenuItem } from '../models/chill-menu.models';
import type { WorkspaceTaskComponentType, WorkspaceTaskConfiguration } from '../models/workspace-task.models';
import { WorkspaceLayoutService } from './workspace-layout.service';
import { WorkspaceTaskDefinition, WorkspaceTaskRegistryService } from './workspace-task-registry.service';

const WORKSPACE_THEME_STORAGE_KEY = 'cini-home.workspace-theme';

export type WorkspaceTheme = 'bright' | 'dark' | 'soft';

interface WorkspaceTaskRoute {
  taskType: string;
  queryParams?: Record<string, string>;
}

export interface WorkspaceTaskInstance {
  id: string;
  taskType: string;
  title: string;
  description: string;
  component: WorkspaceTaskComponentType;
  inputs?: Record<string, unknown>;
  route: WorkspaceTaskRoute;
}

export interface OpenCrudTaskRequest {
  chillType: string;
  viewCode?: string | null;
  displayName?: string | null;
}

export interface OpenWorkspaceTaskRequest {
  componentName: string;
  title?: string | null;
  description?: string | null;
  configuration?: WorkspaceTaskConfiguration | null;
}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly layout = inject(WorkspaceLayoutService);
  private readonly taskRegistry = inject(WorkspaceTaskRegistryService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly drawerOpenState = signal(false);
  private readonly activeTaskIdState = signal<string | null>(null);
  private readonly openTaskInstancesState = signal<WorkspaceTaskInstance[]>([]);
  private readonly storedThemePreference = this.readStoredThemePreference();
  private readonly hasExplicitThemePreferenceState = signal(this.storedThemePreference !== null);
  private readonly themeState = signal<WorkspaceTheme>(this.storedThemePreference ?? this.readSystemThemePreference());

  readonly availableTasks = computed(() => this.taskRegistry.definitions());
  readonly isDrawerOpen = this.drawerOpenState.asReadonly();
  readonly theme = this.themeState.asReadonly();
  readonly isLayoutEditingEnabled = this.layout.isLayoutEditingEnabled;
  readonly openTasks = this.openTaskInstancesState.asReadonly();
  readonly activeTask = computed(() => this.openTaskInstancesState()
    .find((task) => task.id === this.activeTaskIdState()) ?? null);

  constructor() {
    effect(() => {
      const theme = this.themeState();
      this.document.documentElement.setAttribute('data-theme', theme);
      this.document.documentElement.style.setProperty('color-scheme', theme === 'dark' ? 'dark' : 'light');
    });

    this.bindSystemThemePreference();
  }

  async activateTaskFromRoute(taskType: string | null, queryParams: ParamMap): Promise<void> {
    if (!taskType) {
      this.activeTaskIdState.set(null);
      return;
    }

    const task = await this.resolveTaskFromRoute(taskType, queryParams);
    if (!task) {
      void this.router.navigateByUrl('/workspace');
      return;
    }

    const activeTask = this.activeTask();
    if (activeTask && this.isSameTaskRoute(activeTask.route, task.route)) {
      return;
    }

    const existingTask = this.findTaskByRoute(task.route);
    if (existingTask) {
      this.activeTaskIdState.set(existingTask.id);
      this.drawerOpenState.set(false);
      return;
    }

    this.openTaskInstance(task, false);
  }

  async openTask(componentName: string, navigate = true): Promise<void> {
    const taskDefinition = this.getTaskDefinition(componentName);
    if (!taskDefinition) {
      return;
    }

    const task = await this.createStaticTaskInstance(taskDefinition);
    if (!task) {
      return;
    }

    const existingTask = this.findTaskByRoute(task.route);
    if (existingTask) {
      this.activateTask(existingTask.id);
      return;
    }

    this.openTaskInstance(task, navigate);
  }

  async openWorkspaceTask(request: OpenWorkspaceTaskRequest): Promise<void> {
    const taskDefinition = this.getTaskDefinition(request.componentName);
    if (!taskDefinition) {
      return;
    }

    const task = await this.createStaticTaskInstance(taskDefinition, request.title, request.description, request.configuration ?? null);
    if (!task) {
      return;
    }

    const existingTask = this.findTaskByRoute(task.route);
    if (existingTask) {
      this.activateTask(existingTask.id);
      return;
    }

    this.openTaskInstance(task);
  }

  openCrudTask(request: OpenCrudTaskRequest): void {
    const task = this.createCrudTaskInstance(request);
    if (!task) {
      return;
    }

    this.openTaskInstance(task);
  }

  async openMenuItem(item: ChillMenuItem): Promise<void> {
    const componentName = item.componentName.trim();
    const configuration = this.parseMenuConfiguration(item.componentConfigurationJson);

    if (this.normalizeComponentName(componentName) === 'crud') {
      const chillType = this.readConfigString(configuration, ['ChillType', 'chillType', 'Type', 'type']);
      if (!chillType) {
        return;
      }

      this.openCrudTask({
        chillType,
        viewCode: this.readConfigString(configuration, ['ViewCode', 'viewCode']) || 'default',
        displayName: item.title
      });
      return;
    }

    await this.openWorkspaceTask({
      componentName,
      title: item.title,
      description: item.description,
      configuration
    });
  }

  isMenuItemActive(item: ChillMenuItem): boolean {
    const activeTask = this.activeTask();
    if (!activeTask) {
      return false;
    }

    const componentName = this.normalizeComponentName(item.componentName);
    const configuration = this.parseMenuConfiguration(item.componentConfigurationJson);

    if (componentName === 'crud') {
      const chillType = this.readConfigString(configuration, ['ChillType', 'chillType', 'Type', 'type']);
      const viewCode = this.readConfigString(configuration, ['ViewCode', 'viewCode']) || 'default';
      return activeTask.taskType === 'crud'
        && activeTask.inputs?.['initialChillType'] === chillType
        && activeTask.inputs?.['initialViewCode'] === viewCode;
    }

    const expectedRoute = this.createDefaultRoute(
      this.normalizeComponentName(item.componentName),
      item.title,
      item.description,
      configuration
    );

    return this.isSameTaskRoute(activeTask.route, expectedRoute);
  }

  activateTask(taskInstanceId: string): void {
    const task = this.openTaskInstancesState().find((candidate) => candidate.id === taskInstanceId) ?? null;
    if (!task) {
      return;
    }

    this.activeTaskIdState.set(task.id);
    this.drawerOpenState.set(false);
    this.navigateToTask(task);
  }

  closeTask(taskInstanceId: string): void {
    let nextActiveTaskId: string | null = this.activeTaskIdState();

    this.openTaskInstancesState.update((tasks) => {
      const nextTasks = tasks.filter((task) => task.id !== taskInstanceId);
      if (nextActiveTaskId === taskInstanceId) {
        nextActiveTaskId = nextTasks[nextTasks.length - 1]?.id ?? null;
      }
      return nextTasks;
    });

    this.activeTaskIdState.set(nextActiveTaskId);
    const nextActiveTask = this.openTaskInstancesState().find((task) => task.id === nextActiveTaskId) ?? null;
    if (nextActiveTask) {
      this.navigateToTask(nextActiveTask);
      return;
    }

    void this.router.navigate(['/workspace']);
  }

  toggleDrawer(): void {
    this.drawerOpenState.update((isOpen) => !isOpen);
  }

  closeDrawer(): void {
    this.drawerOpenState.set(false);
  }

  setTheme(theme: WorkspaceTheme): void {
    this.themeState.set(theme);
    this.hasExplicitThemePreferenceState.set(true);
    globalThis.localStorage?.setItem(WORKSPACE_THEME_STORAGE_KEY, theme);
  }

  toggleLayoutEditingEnabled(): void {
    this.layout.toggleLayoutEditingEnabled();
  }

  reset(): void {
    this.drawerOpenState.set(false);
    this.activeTaskIdState.set(null);
    this.openTaskInstancesState.set([]);
  }

  private openTaskInstance(task: WorkspaceTaskInstance, navigate = true): void {
    this.openTaskInstancesState.update((tasks) => tasks.some((candidate) => candidate.id === task.id)
      ? tasks
      : [...tasks, task]);
    this.activeTaskIdState.set(task.id);
    this.drawerOpenState.set(false);

    if (navigate) {
      this.navigateToTask(task);
    }
  }

  private navigateToTask(task: WorkspaceTaskInstance): void {
    void this.router.navigate(['/workspace', task.route.taskType], {
      queryParams: task.route.queryParams ?? {}
    });
  }

  private async resolveTaskFromRoute(taskType: string, queryParams: ParamMap): Promise<WorkspaceTaskInstance | null> {
    if (taskType === 'crud') {
      return this.createCrudTaskInstance({
        chillType: queryParams.get('type') ?? '',
        viewCode: queryParams.get('viewCode'),
        displayName: queryParams.get('label')
      });
    }

    const taskDefinition = this.getTaskDefinition(taskType);
    if (!taskDefinition) {
      return null;
    }

    return this.createStaticTaskInstance(
      taskDefinition,
      queryParams.get('title'),
      queryParams.get('description'),
      this.deserializeConfiguration(queryParams.get('config'))
    );
  }

  private async createStaticTaskInstance(
    taskDefinition: WorkspaceTaskDefinition,
    titleOverride?: string | null,
    descriptionOverride?: string | null,
    configuration?: WorkspaceTaskConfiguration | null
  ): Promise<WorkspaceTaskInstance | null> {
    const component = await this.taskRegistry.resolveComponent(taskDefinition.componentName);
    if (!component) {
      return null;
    }

    const title = titleOverride?.trim() || taskDefinition.title;
    const description = descriptionOverride?.trim() || taskDefinition.description;
    const normalizedConfiguration = this.normalizeConfiguration(configuration);

    return {
      id: crypto.randomUUID(),
      taskType: taskDefinition.componentName,
      title,
      description,
      component,
      inputs: taskDefinition.kind === 'remote'
        ? {
            componentConfiguration: normalizedConfiguration ?? {},
            taskTitle: title,
            taskDescription: description
          }
        : undefined,
      route: this.createDefaultRoute(taskDefinition.componentName, title, description, normalizedConfiguration)
    };
  }

  private createCrudTaskInstance(request: OpenCrudTaskRequest): WorkspaceTaskInstance | null {
    const chillType = request.chillType.trim();
    if (!chillType) {
      return null;
    }

    const viewCode = request.viewCode?.trim() || 'default';
    const displayName = request.displayName?.trim() || chillType;

    return {
      id: crypto.randomUUID(),
      taskType: 'crud',
      title: `${displayName} (${viewCode})`,
      description: `CRUD task for ${chillType}`,
      component: CrudTaskComponent,
      inputs: {
        initialChillType: chillType,
        initialViewCode: viewCode
      },
      route: {
        taskType: 'crud',
        queryParams: {
          type: chillType,
          viewCode,
          label: displayName
        }
      }
    };
  }

  private getTaskDefinition(taskType: string): WorkspaceTaskDefinition | null {
    return this.taskRegistry.getTaskDefinition(taskType);
  }

  private findTaskByRoute(route: WorkspaceTaskRoute): WorkspaceTaskInstance | null {
    return this.openTaskInstancesState().find((task) => this.isSameTaskRoute(task.route, route)) ?? null;
  }

  private isSameTaskRoute(left: WorkspaceTaskRoute, right: WorkspaceTaskRoute): boolean {
    if (left.taskType !== right.taskType) {
      return false;
    }

    const leftQueryParams = left.queryParams ?? {};
    const rightQueryParams = right.queryParams ?? {};
    const leftKeys = Object.keys(leftQueryParams);
    const rightKeys = Object.keys(rightQueryParams);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => leftQueryParams[key] === rightQueryParams[key]);
  }

  private bindSystemThemePreference(): void {
    if (typeof globalThis.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const applySystemTheme = () => {
      if (this.hasExplicitThemePreferenceState()) {
        return;
      }

      this.themeState.set(mediaQuery.matches ? 'dark' : 'bright');
    };

    applySystemTheme();

    const handleChange = () => applySystemTheme();
    mediaQuery.addEventListener('change', handleChange);
    this.destroyRef.onDestroy(() => mediaQuery.removeEventListener('change', handleChange));
  }

  private readStoredThemePreference(): WorkspaceTheme | null {
    const storedTheme = globalThis.localStorage?.getItem(WORKSPACE_THEME_STORAGE_KEY)?.trim().toLowerCase();
    switch (storedTheme) {
      case 'dark':
      case 'soft':
      case 'bright':
        return storedTheme;
      default:
        return null;
    }
  }

  private readSystemThemePreference(): WorkspaceTheme {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'bright';
  }

  private createDefaultRoute(
    componentName: string,
    title: string | null | undefined,
    description: string | null | undefined,
    configuration: WorkspaceTaskConfiguration | null
  ): WorkspaceTaskRoute {
    const queryParams: Record<string, string> = {};
    const normalizedTitle = title?.trim() ?? '';
    if (normalizedTitle) {
      queryParams['title'] = normalizedTitle;
    }
    const normalizedDescription = description?.trim() ?? '';
    if (normalizedDescription) {
      queryParams['description'] = normalizedDescription;
    }

    const serializedConfiguration = this.serializeConfiguration(configuration);
    if (serializedConfiguration) {
      queryParams['config'] = serializedConfiguration;
    }

    return {
      taskType: this.normalizeComponentName(componentName),
      queryParams
    };
  }

  private normalizeComponentName(value: string): string {
    return value.trim().toLowerCase();
  }

  private normalizeConfiguration(configuration: WorkspaceTaskConfiguration | null | undefined): WorkspaceTaskConfiguration | null {
    if (!configuration || Object.keys(configuration).length === 0) {
      return null;
    }

    return configuration;
  }

  private serializeConfiguration(configuration: WorkspaceTaskConfiguration | null): string {
    if (!configuration) {
      return '';
    }

    try {
      return JSON.stringify(configuration);
    } catch {
      return '';
    }
  }

  private deserializeConfiguration(rawConfiguration: string | null): WorkspaceTaskConfiguration | null {
    if (!rawConfiguration?.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawConfiguration);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as WorkspaceTaskConfiguration
        : null;
    } catch {
      return null;
    }
  }

  private parseMenuConfiguration(value: string | null): WorkspaceTaskConfiguration | null {
    return this.deserializeConfiguration(value);
  }

  private readConfigString(
    configuration: WorkspaceTaskConfiguration | null,
    keys: string[]
  ): string {
    if (!configuration) {
      return '';
    }

    for (const key of keys) {
      const value = configuration[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    const normalizedKeys = keys.map((key) => key.toLowerCase());
    for (const [key, value] of Object.entries(configuration)) {
      if (typeof value === 'string' && value.trim() && normalizedKeys.includes(key.toLowerCase())) {
        return value.trim();
      }
    }

    return '';
  }
}
