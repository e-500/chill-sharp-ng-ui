import type { WorkspaceTaskRuntimeConfig } from './models/workspace-task.models';

declare global {
  var CHILLSHARP_API_URL: string | undefined;
  var CHILLSHARP_UI_URL: string | undefined;
  var __chillSharpNgUiRuntimeConfig__: WorkspaceTaskRuntimeConfig | undefined;
}

export {};
