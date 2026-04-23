import { CommonModule } from '@angular/common';
import { Component, inject, input, signal, effect } from '@angular/core';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { ChillJsonInputComponent } from './chill-json-input.component';

@Component({
  selector: 'app-chill-text-editor-dialog',
  standalone: true,
  imports: [CommonModule, ChillJsonInputComponent],
  template: `
    <section class="text-editor-dialog">
      <app-chill-json-input
        [value]="draft()"
        [language]="language()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        minHeight="18rem"
        maxHeight="70vh"
        (valueChange)="draft.set($event)"></app-chill-json-input>
    </section>
  `,
  styles: [`
    .text-editor-dialog {
      display: block;
      min-width: min(58rem, calc(100vw - 5rem));
    }

    @media (max-width: 720px) {
      .text-editor-dialog {
        min-width: 0;
      }
    }
  `]
})
export class ChillTextEditorDialogComponent {
  private readonly dialog = inject(WorkspaceDialogService);

  readonly value = input('');
  readonly language = input<'json' | 'plaintext'>('plaintext');
  readonly placeholder = input('');
  readonly disabled = input(false);

  readonly draft = signal('');

  constructor() {
    effect(() => {
      this.draft.set(this.value());
    });
  }

  submit(): void {
    this.dialog.confirm(this.draft());
  }
}
