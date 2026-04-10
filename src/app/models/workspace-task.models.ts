import type { Type } from '@angular/core';

export interface WorkspaceTaskComponent<TResult = unknown> {
  dialogResult?(): TResult | Promise<TResult>;
  canDialogSubmit?(): boolean;
}

export type WorkspaceTaskComponentType = Type<unknown>;
export type WorkspaceTaskConfiguration = Record<string, unknown>;

export interface WorkspaceRemoteTaskDefinition {
  componentName: string;
  title?: string | null;
  description?: string | null;
  remoteEntry: string;
  remoteName: string;
  exposedModule: string;
  exportedComponentName?: string | null;
  routePath?: string | null;
  showInQuickLaunch?: boolean | null;
}

export interface WorkspaceTaskSourceIndex {
  sourceName?: string | null;
  tasks: WorkspaceRemoteTaskDefinition[];
}

export interface WorkspaceTaskRuntimeConfig {
  workspaceTaskSources?: string[] | null;
}

export interface WorkspaceFederationContainer {
  init?(shareScope: unknown): Promise<unknown> | unknown;
  get(module: string): Promise<(() => unknown)> | (() => unknown);
}
