import type { Type } from '@angular/core';

export interface WorkspaceTaskComponent<TResult = unknown> {
  dialogResult?(): TResult | Promise<TResult>;
}

export type WorkspaceTaskComponentType = Type<unknown>;
