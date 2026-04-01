import { DOCUMENT } from '@angular/common';
import { Injectable, Type, computed, effect, inject, signal } from '@angular/core';
import { ParamMap, Router } from '@angular/router';
import { EventViewerComponent } from '../pages/atlas/event-viewer/event-viewer.component';
import { PermissionsPageComponent } from '../pages/permissions/permissions-page.component';
import { CrudTaskComponent } from '../tasks/crud-task/crud-task.component';
import type { WorkspaceTaskComponentType } from '../models/workspace-task.models';
import { WorkspaceLayoutService } from './workspace-layout.service';

const WORKSPACE_THEME_STORAGE_KEY = 'cini-home.workspace-theme';

export type WorkspaceTheme = 'bright' | 'dark' | 'soft';

export interface WorkspaceTaskDefinition {
  id: string;
  title: string;
  description: string;
  component: WorkspaceTaskComponentType;
}

interface WorkspaceTaskRoute {
  taskId: string;
  queryParams?: Record<string, string>;
}

export interface WorkspaceTaskInstance {
  id: string;
  definitionId: string;
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

const WORKSPACE_TASKS: WorkspaceTaskDefinition[] = [
  {
    id: 'event-viewer',
    title: 'Event Viewer',
    description: 'Browse event stream data.',
    component: EventViewerComponent
  },
  {
    id: 'permissions',
    title: 'Permissions',
    description: 'Manage roles, users, and access rules.',
    component: PermissionsPageComponent
  },
  {
    id: 'crud',
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

  private readonly drawerOpenState = signal(false);
  private readonly activeTaskIdState = signal<string | null>(null);
  private readonly openTaskInstancesState = signal<WorkspaceTaskInstance[]>([]);
  private readonly themeState = signal<WorkspaceTheme>(this.readStoredTheme());

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
      globalThis.localStorage?.setItem(WORKSPACE_THEME_STORAGE_KEY, theme);
    });

  }

  activateTaskFromRoute(taskId: string | null, queryParams: ParamMap): void {
    if (!taskId) {
      this.activeTaskIdState.set(null);
      return;
    }

    const task = this.resolveTaskFromRoute(taskId, queryParams);
    if (!task) {
      void this.router.navigateByUrl('/workspace');
      return;
    }

    this.openTaskInstance(task, false);
  }

  openTask(taskId: string, navigate = true): void {
    const taskDefinition = this.getTaskDefinition(taskId);
    if (!taskDefinition) {
      return;
    }

    this.openTaskInstance(this.createStaticTaskInstance(taskDefinition), navigate);
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
    this.activeTaskIdState.set(task.id);
    this.openTaskInstancesState.update((tasks) => tasks.some((candidate) => candidate.id === task.id)
      ? tasks
      : [...tasks, task]);
    this.drawerOpenState.set(false);

    if (navigate) {
      this.navigateToTask(task);
    }
  }

  private navigateToTask(task: WorkspaceTaskInstance): void {
    void this.router.navigate(['/workspace', task.route.taskId], {
      queryParams: task.route.queryParams ?? {}
    });
  }

  private resolveTaskFromRoute(taskId: string, queryParams: ParamMap): WorkspaceTaskInstance | null {
    if (taskId === 'crud') {
      return this.createCrudTaskInstance({
        chillType: queryParams.get('type') ?? '',
        viewCode: queryParams.get('viewCode'),
        displayName: queryParams.get('label')
      });
    }

    const taskDefinition = this.getTaskDefinition(taskId);
    return taskDefinition ? this.createStaticTaskInstance(taskDefinition) : null;
  }

  private createStaticTaskInstance(taskDefinition: WorkspaceTaskDefinition): WorkspaceTaskInstance {
    return {
      id: taskDefinition.id,
      definitionId: taskDefinition.id,
      title: taskDefinition.title,
      description: taskDefinition.description,
      component: taskDefinition.component,
      route: {
        taskId: taskDefinition.id
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
      id: `crud:${chillType}:${viewCode}`,
      definitionId: 'crud',
      title: `${displayName} (${viewCode})`,
      description: `CRUD task for ${chillType}`,
      component: CrudTaskComponent,
      inputs: {
        initialChillType: chillType,
        initialViewCode: viewCode
      },
      route: {
        taskId: 'crud',
        queryParams: {
          type: chillType,
          viewCode,
          label: displayName
        }
      }
    };
  }

  private getTaskDefinition(taskId: string): WorkspaceTaskDefinition | null {
    return this.availableTasks.find((task) => task.id === taskId) ?? null;
  }

  private readStoredTheme(): WorkspaceTheme {
    const storedTheme = globalThis.localStorage?.getItem(WORKSPACE_THEME_STORAGE_KEY)?.trim().toLowerCase();
    switch (storedTheme) {
      case 'dark':
      case 'soft':
      case 'bright':
        return storedTheme;
      default:
        return 'bright';
    }
  }
}
