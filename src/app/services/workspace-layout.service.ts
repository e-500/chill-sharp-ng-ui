import { Injectable, effect, signal } from '@angular/core';

const WORKSPACE_LAYOUT_EDITING_STORAGE_KEY = 'chill-sharp-ng-ui.workspace-layout-editing';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceLayoutService {
  private readonly layoutEditingEnabledState = signal(this.readStoredLayoutEditingState());

  readonly isLayoutEditingEnabled = this.layoutEditingEnabledState.asReadonly();

  constructor() {
    effect(() => {
      globalThis.localStorage?.setItem(
        WORKSPACE_LAYOUT_EDITING_STORAGE_KEY,
        this.layoutEditingEnabledState() ? 'true' : 'false'
      );
    });
  }

  toggleLayoutEditingEnabled(): void {
    this.layoutEditingEnabledState.update((enabled) => !enabled);
  }

  private readStoredLayoutEditingState(): boolean {
    return globalThis.localStorage?.getItem(WORKSPACE_LAYOUT_EDITING_STORAGE_KEY)?.trim().toLowerCase() === 'true';
  }
}
