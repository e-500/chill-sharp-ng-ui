import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { WorkspaceService } from '../services/workspace.service';

@Component({
  selector: 'app-workspace-taskbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="taskbar">
      @if (workspace.openTasks().length === 0) {
        <p class="taskbar__empty">Open tasks will appear here.</p>
      } @else {
        @for (task of workspace.openTasks(); track task.id) {
          <div class="taskbar__item" [class.active]="workspace.activeTask()?.id === task.id">
            <button type="button" class="taskbar__link" (click)="workspace.activateTask(task.id)">
              {{ task.title }}
            </button>
            <button
              type="button"
              class="taskbar__close"
              (click)="workspace.closeTask(task.id)"
              [attr.aria-label]="'Close ' + task.title">
              x
            </button>
          </div>
        }
      }
    </div>
  `
})
export class WorkspaceTaskbarComponent {
  readonly workspace = inject(WorkspaceService);
}
