import { Injectable, signal } from '@angular/core';

export interface WorkspaceToolbarButton {
  id: string;
  label?: string;
  labelGuid?: string | null;
  primaryDefaultText?: string | null;
  secondaryDefaultText?: string | null;
  ariaLabel?: string;
  icon?: string | null;
  iconClass?: string | null;
  accent?: boolean;
  action: () => void;
  disabled?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class WorkspaceToolbarService {
  private readonly buttonScopesState = signal<Record<string, WorkspaceToolbarButton[]>>({});

  buttons(scope = 'workspace'): WorkspaceToolbarButton[] {
    return this.buttonScopesState()[scope] ?? [];
  }

  setButtons(buttons: WorkspaceToolbarButton[], scope = 'workspace'): void {
    this.buttonScopesState.update((current) => ({
      ...current,
      [scope]: [...buttons]
    }));
  }

  clearButtons(scope = 'workspace'): void {
    this.buttonScopesState.update((current) => {
      if (!(scope in current)) {
        return current;
      }

      const { [scope]: _removedScope, ...rest } = current;
      return rest;
    });
  }
}
