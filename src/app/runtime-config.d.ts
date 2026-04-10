import type { WorkspaceTaskRuntimeConfig } from './models/workspace-task.models';

declare global {
  var __chillSharpNgUiRuntimeConfig__: WorkspaceTaskRuntimeConfig | undefined;
}

export {};
