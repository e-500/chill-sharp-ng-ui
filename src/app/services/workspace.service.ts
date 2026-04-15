import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { CrudPageComponentConfiguration } from '../pages/crud/crud-page.component';
import type { ChillMenuItem } from '../models/chill-menu.models';
import type { WorkspaceTaskComponent, WorkspaceTaskComponentType, WorkspaceTaskConfiguration } from '../models/workspace-task.models';
import { ChillService } from './chill.service';
import { WorkspaceDialogService } from './workspace-dialog.service';
import { WorkspaceLayoutService } from './workspace-layout.service';
import { WorkspaceTaskDefinition, WorkspaceTaskRegistryService } from './workspace-task-registry.service';

const WORKSPACE_THEME_STORAGE_KEY = 'chill-sharp-ng-ui.workspace-theme';
const ACTIVE_MENU_ITEM_QUERY_PARAM = 'activeMenuItem';

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
  toolbarScope: string;
  menuItemGuid?: string | null;
  inputs?: Record<string, unknown>;
  route: WorkspaceTaskRoute;
}

export interface OpenCrudTaskRequest {
  chillType: string;
  viewCode?: string | null;
  displayName?: string | null;
  queryChillType?: string | null;
  componentConfiguration?: CrudPageComponentConfiguration | null;
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
  private readonly chill = inject(ChillService);
  private readonly dialog = inject(WorkspaceDialogService);
  private readonly layout = inject(WorkspaceLayoutService);
  private readonly taskRegistry = inject(WorkspaceTaskRegistryService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly drawerOpenState = signal(false);
  private readonly activeTaskIdState = signal<string | null>(null);
  private readonly openTaskInstancesState = signal<WorkspaceTaskInstance[]>([]);
  private taskComponentResolver: ((taskId: string) => WorkspaceTaskComponent | null) | null = null;
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
    const activeMenuItemGuid = this.readActiveMenuItemGuid(queryParams);
    if (activeMenuItemGuid) {
      const currentActiveMenuItemGuid = this.activeTask()?.menuItemGuid?.trim() ?? '';
      if (currentActiveMenuItemGuid === activeMenuItemGuid) {
        this.drawerOpenState.set(false);
        return;
      }

      const existingTask = this.findTaskByMenuItemGuid(activeMenuItemGuid);
      if (existingTask) {
        this.activeTaskIdState.set(existingTask.id);
        this.drawerOpenState.set(false);
        return;
      }

      const restoredTask = await this.restoreMenuTaskFromRoute(activeMenuItemGuid);
      if (!restoredTask) {
        if (this.openTaskInstancesState().length === 0) {
          this.activeTaskIdState.set(null);
        }
        this.drawerOpenState.set(false);
        return;
      }

      if (this.openTaskInstancesState().length === 0) {
        this.openTaskInstancesState.set([restoredTask]);
      } else {
        this.openTaskInstancesState.update((tasks) => [...tasks, restoredTask]);
      }

      this.activeTaskIdState.set(restoredTask.id);
      this.drawerOpenState.set(false);
      return;
    }

    if (!taskType) {
      if (this.openTaskInstancesState().length === 0) {
        this.activeTaskIdState.set(null);
      }
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

    this.openTaskInstance(task);
  }

  openCrudTask(request: OpenCrudTaskRequest): void {
    const chillType = request.chillType.trim();
    if (!chillType) {
      return;
    }

    const configuration = this.buildCrudTaskConfiguration(request);
    void this.openWorkspaceTask({
      componentName: 'crud',
      title: request.displayName?.trim() || chillType,
      description: `CRUD task for ${chillType}`,
      configuration
    });
  }

  async openMenuItem(item: ChillMenuItem): Promise<void> {
    const task = await this.createMenuTaskInstance(item);
    if (!task) {
      return;
    }

    this.openTaskInstance(task);
  }

  isMenuItemActive(item: ChillMenuItem): boolean {
    return this.activeTask()?.menuItemGuid === item.guid;
  }

  async activateTask(taskInstanceId: string): Promise<void> {
    const task = this.openTaskInstancesState().find((candidate) => candidate.id === taskInstanceId) ?? null;
    if (!task) {
      return;
    }

    const currentActiveTaskId = this.activeTaskIdState();
    if (currentActiveTaskId && currentActiveTaskId !== task.id) {
      const canLeaveCurrentTask = await this.confirmTaskCanBeLeft(currentActiveTaskId);
      if (!canLeaveCurrentTask) {
        return;
      }
    }

    this.activeTaskIdState.set(task.id);
    this.drawerOpenState.set(false);
    this.navigateToTask(task);
  }

  async closeTask(taskInstanceId: string): Promise<void> {
    const canCloseTask = await this.confirmTaskCanBeLeft(taskInstanceId);
    if (!canCloseTask) {
      return;
    }

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

  async reset(): Promise<boolean> {
    const canReset = await this.confirmAllTasksCanBeClosed();
    if (!canReset) {
      return false;
    }

    this.drawerOpenState.set(false);
    this.activeTaskIdState.set(null);
    this.openTaskInstancesState.set([]);
    return true;
  }

  registerTaskComponentResolver(resolver: ((taskId: string) => WorkspaceTaskComponent | null) | null): void {
    this.taskComponentResolver = resolver;
  }

  canUnloadWorkspace(): boolean {
    const activeTaskId = this.activeTaskIdState();
    if (!activeTaskId) {
      return true;
    }

    const component = this.taskComponentResolver?.(activeTaskId) ?? null;
    if (!component?.isAllSaved) {
      return true;
    }

    try {
      return component.isAllSaved() === true;
    } catch {
      return false;
    }
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
    void this.router.navigate(['/workspace'], {
      queryParams: this.buildWorkspaceQueryParams(task)
    });
  }

  private async resolveTaskFromRoute(taskType: string, queryParams: ParamMap): Promise<WorkspaceTaskInstance | null> {
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

    const taskId = crypto.randomUUID();
    const title = titleOverride?.trim() || taskDefinition.title;
    const description = descriptionOverride?.trim() || taskDefinition.description;
    const normalizedConfiguration = this.normalizeConfiguration(configuration);
    const toolbarScope = `workspace-task-${taskId}`;

    return {
      id: taskId,
      taskType: taskDefinition.componentName,
      title,
      description,
      component,
      toolbarScope,
      menuItemGuid: null,
      inputs: taskDefinition.kind === 'remote' || taskDefinition.usesTaskConfigurationInputs
        ? {
            componentConfiguration: normalizedConfiguration ?? {},
            taskTitle: title,
            taskDescription: description,
            toolbarScope
          }
        : undefined,
      route: this.createDefaultRoute(taskDefinition.componentName, title, description, normalizedConfiguration)
    };
  }

  private async createMenuTaskInstance(item: ChillMenuItem): Promise<WorkspaceTaskInstance | null> {
    const componentName = this.normalizeComponentName(item.componentName);
    const taskDefinition = this.getTaskDefinition(componentName);
    if (!taskDefinition) {
      return null;
    }

    const task = await this.createStaticTaskInstance(
      taskDefinition,
      item.title,
      item.description,
      this.parseMenuConfiguration(item.componentConfigurationJson)
    );
    if (!task) {
      return null;
    }

    return {
      ...task,
      menuItemGuid: item.guid?.trim() || null
    };
  }

  private getTaskDefinition(taskType: string): WorkspaceTaskDefinition | null {
    return this.taskRegistry.getTaskDefinition(taskType);
  }

  private findTaskByRoute(route: WorkspaceTaskRoute): WorkspaceTaskInstance | null {
    return this.openTaskInstancesState().find((task) => this.isSameTaskRoute(task.route, route)) ?? null;
  }

  private findTaskByMenuItemGuid(menuItemGuid: string): WorkspaceTaskInstance | null {
    const normalizedMenuItemGuid = menuItemGuid.trim();
    if (!normalizedMenuItemGuid) {
      return null;
    }

    return this.openTaskInstancesState().find((task) => task.menuItemGuid === normalizedMenuItemGuid) ?? null;
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

  private buildWorkspaceQueryParams(activeTask: WorkspaceTaskInstance | null): Record<string, string | string[]> {
    const activeMenuItem = activeTask?.menuItemGuid?.trim() ?? '';
    return activeMenuItem
      ? { [ACTIVE_MENU_ITEM_QUERY_PARAM]: activeMenuItem }
      : {};
  }

  private readActiveMenuItemGuid(queryParams: ParamMap): string {
    return queryParams.get(ACTIVE_MENU_ITEM_QUERY_PARAM)?.trim() ?? '';
  }

  private findActiveTaskIdForMenuItemGuid(activeMenuItemGuid: string): string | null {
    if (!activeMenuItemGuid) {
      return null;
    }

    return this.findTaskByMenuItemGuid(activeMenuItemGuid)?.id ?? null;
  }

  private findTaskIdByMenuItemGuid(tasks: WorkspaceTaskInstance[], menuItemGuid: string): string | null {
    if (!menuItemGuid) {
      return null;
    }

    return tasks.find((task) => task.menuItemGuid === menuItemGuid)?.id ?? null;
  }

  private async restoreMenuTaskFromRoute(activeMenuItemGuid: string): Promise<WorkspaceTaskInstance | null> {
    const menuItems = await this.loadMenuItemsByGuids([activeMenuItemGuid]);
    const menuItem = menuItems.get(activeMenuItemGuid);
    if (!menuItem) {
      return null;
    }

    return this.createMenuTaskInstance(menuItem);
  }

  private async loadMenuItemsByGuids(targetGuids: string[]): Promise<Map<string, ChillMenuItem>> {
    const remainingGuids = new Set(targetGuids.map((guid) => guid.trim()).filter((guid) => guid.length > 0));
    const resolvedMenuItems = new Map<string, ChillMenuItem>();
    const parentQueue: Array<string | null> = [null];
    const visitedParents = new Set<string>();

    while (parentQueue.length > 0 && remainingGuids.size > 0) {
      const parentGuid = parentQueue.shift() ?? null;
      const parentKey = parentGuid ?? '__root__';
      if (visitedParents.has(parentKey)) {
        continue;
      }

      visitedParents.add(parentKey);

      let items: ChillMenuItem[] = [];
      try {
        items = await firstValueFrom(this.chill.getMenu(parentGuid));
      } catch {
        continue;
      }

      for (const item of items) {
        const itemGuid = item.guid?.trim() ?? '';
        if (itemGuid) {
          parentQueue.push(itemGuid);
        }

        if (!itemGuid || !remainingGuids.has(itemGuid)) {
          continue;
        }

        resolvedMenuItems.set(itemGuid, item);
        remainingGuids.delete(itemGuid);
      }
    }

    return resolvedMenuItems;
  }

  private async confirmAllTasksCanBeClosed(): Promise<boolean> {
    const taskIds = this.openTaskInstancesState().map((task) => task.id);
    for (const taskId of taskIds) {
      const canLeaveTask = await this.confirmTaskCanBeLeft(taskId);
      if (!canLeaveTask) {
        return false;
      }
    }

    return true;
  }

  private async confirmTaskCanBeLeft(taskId: string): Promise<boolean> {
    const component = this.taskComponentResolver?.(taskId) ?? null;
    if (!component?.isAllSaved) {
      return true;
    }

    let isAllSaved = true;
    try {
      isAllSaved = await component.isAllSaved();
    } catch {
      isAllSaved = false;
    }

    if (isAllSaved) {
      return true;
    }

    const taskTitle = this.openTaskInstancesState().find((task) => task.id === taskId)?.title
      || this.chill.T('68E40F26-CE4E-4FD1-9D2A-505B495D1608', 'this task', 'questa attivita');

    return this.dialog.confirmYesNo(
      this.chill.T('C215A6B1-F772-478D-8FB2-8A7A495F694E', 'Unsaved changes', 'Modifiche non salvate'),
      this.chill.T(
        '05105AA0-B849-4020-8018-03C97CB92605',
        `There is unsaved or unfinished work in ${taskTitle}. Do you want to leave it anyway?`,
        `Ci sono modifiche non salvate o attivita non completate in ${taskTitle}. Vuoi comunque uscire?`
      )
    );
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

  private toWorkspaceTaskConfiguration(configuration: CrudPageComponentConfiguration | null | undefined): WorkspaceTaskConfiguration | null {
    if (!configuration) {
      return null;
    }

    const entries = Object.entries(configuration)
      .filter(([, value]) => value !== undefined && value !== null);
    if (entries.length === 0) {
      return null;
    }

    return Object.fromEntries(entries) as WorkspaceTaskConfiguration;
  }

  private buildCrudTaskConfiguration(request: OpenCrudTaskRequest): WorkspaceTaskConfiguration {
    const configuration = this.toWorkspaceTaskConfiguration(request.componentConfiguration) ?? {};
    const chillType = request.chillType.trim();
    const viewCode = request.viewCode?.trim() || 'default';
    const queryChillType = request.queryChillType?.trim() || null;

    return {
      ...configuration,
      chillType,
      viewCode,
      ...(queryChillType ? { chillQuery: queryChillType } : {})
    };
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
