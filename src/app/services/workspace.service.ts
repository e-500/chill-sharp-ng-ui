import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { EventViewerComponent } from '../pages/atlas/event-viewer/event-viewer.component';
import { PermissionsPageComponent } from '../pages/permissions/permissions-page.component';
import { CrudTaskComponent } from '../tasks/crud-task/crud-task.component';
import type { WorkspaceTaskComponentType } from '../models/workspace-task.models';
import { WorkspaceLayoutService } from './workspace-layout.service';

const WORKSPACE_THEME_STORAGE_KEY = 'cini-home.workspace-theme';

export type WorkspaceTheme = 'bright' | 'dark' | 'soft';

export interface WorkspaceTaskDefinition {
  type: string;
  title: string;
  description: string;
  component: WorkspaceTaskComponentType;
}

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
  taskType: string;
  title?: string | null;
  description?: string | null;
}

const WORKSPACE_TASKS: WorkspaceTaskDefinition[] = [
  {
    type: 'event-viewer',
    title: 'Event Viewer',
    description: 'Browse event stream data.',
    component: EventViewerComponent
  },
  {
    type: 'permissions',
    title: 'Permissions',
    description: 'Manage roles, users, and access rules.',
    component: PermissionsPageComponent
  },
  {
    type: 'crud',
    title: 'CRUD',
    description: 'Inspect schemas and work with entities.',
    component: CrudTaskComponent
  }
];

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly layout = inject(WorkspaceLayoutService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly drawerOpenState = signal(false);
  private readonly activeTaskIdState = signal<string | null>(null);
  private readonly openTaskInstancesState = signal<WorkspaceTaskInstance[]>([]);
  private readonly storedThemePreference = this.readStoredThemePreference();
  private readonly hasExplicitThemePreferenceState = signal(this.storedThemePreference !== null);
  private readonly themeState = signal<WorkspaceTheme>(this.storedThemePreference ?? this.readSystemThemePreference());

  readonly availableTasks = WORKSPACE_TASKS;
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

  activateTaskFromRoute(taskType: string | null, queryParams: ParamMap): void {
    if (!taskType) {
      this.activeTaskIdState.set(null);
      return;
    }

    const task = this.resolveTaskFromRoute(taskType, queryParams);
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

  openTask(taskType: string, navigate = true): void {
    const taskDefinition = this.getTaskDefinition(taskType);
    if (!taskDefinition) {
      return;
    }

    const task = this.createStaticTaskInstance(taskDefinition);
    const existingTask = this.findTaskByRoute(task.route);
    if (existingTask) {
      this.activateTask(existingTask.id);
      return;
    }

    this.openTaskInstance(task, navigate);
  }

  openWorkspaceTask(request: OpenWorkspaceTaskRequest): void {
    const taskDefinition = this.getTaskDefinition(request.taskType);
    if (!taskDefinition) {
      return;
    }

    const task = this.createStaticTaskInstance(taskDefinition, request.title, request.description);
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

  private resolveTaskFromRoute(taskType: string, queryParams: ParamMap): WorkspaceTaskInstance | null {
    if (taskType === 'crud') {
      return this.createCrudTaskInstance({
        chillType: queryParams.get('type') ?? '',
        viewCode: queryParams.get('viewCode'),
        displayName: queryParams.get('label')
      });
    }

    const taskDefinition = this.getTaskDefinition(taskType);
    return taskDefinition ? this.createStaticTaskInstance(taskDefinition) : null;
  }

  private createStaticTaskInstance(
    taskDefinition: WorkspaceTaskDefinition,
    titleOverride?: string | null,
    descriptionOverride?: string | null
  ): WorkspaceTaskInstance {
    return {
      id: crypto.randomUUID(),
      taskType: taskDefinition.type,
      title: titleOverride?.trim() || taskDefinition.title,
      description: descriptionOverride?.trim() || taskDefinition.description,
      component: taskDefinition.component,
      route: {
        taskType: taskDefinition.type
      }
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
    return this.availableTasks.find((task) => task.type === taskType) ?? null;
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
}
