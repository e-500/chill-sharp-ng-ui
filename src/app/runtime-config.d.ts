import type { WorkspaceTaskRuntimeConfig } from './models/workspace-task.models';

declare global {
  var __ciniHomeRuntimeConfig__: WorkspaceTaskRuntimeConfig | undefined;
}

export {};
