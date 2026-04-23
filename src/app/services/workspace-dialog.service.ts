import { Injectable, computed, signal } from '@angular/core';
import type { WorkspaceDialogRequest, WorkspaceDialogResult } from '../models/workspace-dialog.models';

interface ActiveWorkspaceDialog<TResult = unknown> extends WorkspaceDialogRequest<TResult> {
  id: number;
  resolve: (result: WorkspaceDialogResult<TResult>) => void;
}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceDialogService {
  private readonly dialogStackState = signal<ActiveWorkspaceDialog<unknown>[]>([]);
  private nextDialogId = 1;

  readonly dialogs = computed(() => this.dialogStackState());

  readonly activeDialog = computed(() => {
    const dialogStack = this.dialogStackState();
    return dialogStack.length > 0 ? dialogStack[dialogStack.length - 1] : null;
  });

  openDialog<TResult>(request: WorkspaceDialogRequest<TResult>): Promise<WorkspaceDialogResult<TResult>> {
    return new Promise<WorkspaceDialogResult<TResult>>((resolve) => {
      this.dialogStackState.update((current) => [...current, {
        id: this.nextDialogId++,
        okLabel: 'OK',
        cancelLabel: 'Cancel',
        showOkButton: true,
        showCancelButton: true,
        ...request,
        resolve
      } as ActiveWorkspaceDialog<unknown>]);
    });
  }

  async confirmOk(title: string, description: string): Promise<boolean> {
    const { ConfirmMessageDialogComponent } = await import('../workspace/confirm-message-dialog.component');
    const result = await this.openDialog<boolean>({
      title,
      component: ConfirmMessageDialogComponent,
      showOkButton: false,
      showCancelButton: false,
      inputs: {
        description,
        buttons: [
          {
            label: 'OK',
            value: true,
            primary: true
          }
        ]
      }
    });

    return result.status === 'confirmed' && result.value === true;
  }

  async confirmYesNo(title: string, description: string): Promise<boolean> {
    const { ConfirmMessageDialogComponent } = await import('../workspace/confirm-message-dialog.component');
    const result = await this.openDialog<boolean>({
      title,
      component: ConfirmMessageDialogComponent,
      showOkButton: false,
      showCancelButton: false,
      inputs: {
        description,
        buttons: [
          {
            label: 'No',
            value: false
          },
          {
            label: 'Yes',
            value: true,
            primary: true
          }
        ]
      }
    });

    return result.status === 'confirmed' && result.value === true;
  }

  confirm<TResult>(value?: TResult): void {
    const dialogStack = this.dialogStackState();
    const activeDialog = dialogStack.length > 0
      ? dialogStack[dialogStack.length - 1] as ActiveWorkspaceDialog<TResult>
      : null;
    if (!activeDialog) {
      return;
    }

    this.dialogStackState.update((current) => current.slice(0, -1));
    activeDialog.resolve({
      status: 'confirmed',
      value
    });
  }

  cancel(): void {
    this.cancelActiveDialog();
  }

  private cancelActiveDialog(): void {
    const dialogStack = this.dialogStackState();
    const activeDialog = dialogStack.length > 0 ? dialogStack[dialogStack.length - 1] : null;
    if (!activeDialog) {
      return;
    }

    this.dialogStackState.update((current) => current.slice(0, -1));
    activeDialog.resolve({
      status: 'cancelled'
    });
  }
}
