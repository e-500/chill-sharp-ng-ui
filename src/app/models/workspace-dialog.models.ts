import type { WorkspaceTaskComponentType } from './workspace-task.models';

export interface WorkspaceDialogRequest<TResult = unknown> {
  title: string;
  component: WorkspaceTaskComponentType;
  inputs?: Record<string, unknown>;
  okLabel?: string;
  cancelLabel?: string;
  showOkButton?: boolean;
  showCancelButton?: boolean;
}

export interface WorkspaceDialogResult<TResult = unknown> {
  status: 'confirmed' | 'cancelled';
  value?: TResult;
}
