import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  inject,
  input,
  output
} from '@angular/core';

type MonacoModule = typeof import('monaco-editor/esm/vs/editor/editor.api');

@Component({
  selector: 'app-chill-json-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="json-editor" [class.is-invalid]="invalid()">
      <div #editorHost class="json-editor__host" [ngStyle]="editorStyle()"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .json-editor {
      border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border-color));
      border-radius: 0.7rem;
      overflow: hidden;
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 20%, transparent), transparent 30%),
        linear-gradient(180deg, color-mix(in srgb, var(--surface-0) 96%, rgba(2, 16, 25, 0.14)), color-mix(in srgb, var(--surface-1) 92%, rgba(1, 10, 18, 0.18)));
      box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent),
        0 0 0.7rem color-mix(in srgb, var(--accent) 6%, transparent);
    }

    .json-editor.is-invalid {
      border-color: color-mix(in srgb, var(--danger) 70%, var(--border-color));
      box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--danger) 18%, transparent),
        0 0 0.7rem color-mix(in srgb, var(--danger) 8%, transparent);
    }

    .json-editor__host {
      width: 100%;
    }

    :root[data-theme='dark'] .json-editor {
      background: rgba(9, 19, 26, 0.58);
    }
  `]
})
export class ChillJsonInputComponent implements AfterViewInit, OnChanges, OnDestroy {
  readonly value = input('');
  readonly placeholder = input('');
  readonly invalid = input(false);
  readonly disabled = input(false);
  readonly language = input<'json' | 'plaintext'>('json');
  readonly minHeight = input('4rem');
  readonly maxHeight = input('50vh');

  readonly valueChange = output<string>();
  readonly blur = output<void>();

  @ViewChild('editorHost', { static: true }) private editorHost?: ElementRef<HTMLDivElement>;

  private readonly zone = inject(NgZone);
  private monaco: MonacoModule | null = null;
  private editor: any = null;
  private model: any = null;
  private resizeObserver: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private suppressValueEmit = false;

  async ngAfterViewInit(): Promise<void> {
    const host = this.editorHost?.nativeElement;
    if (!host) {
      return;
    }

    this.monaco = await import('monaco-editor/esm/vs/editor/editor.api');

    this.model = this.monaco.editor.createModel(this.value(), this.language());
    this.editor = this.monaco.editor.create(host, {
      model: this.model,
      language: this.language(),
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      formatOnPaste: this.language() === 'json',
      formatOnType: this.language() === 'json',
      wordWrap: 'on',
      lineNumbersMinChars: 3,
      padding: { top: 12, bottom: 12 },
      roundedSelection: false,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
      },
      overviewRulerLanes: 0,
      fontSize: 13,
      readOnly: this.disabled(),
      ariaLabel: this.placeholder() || this.defaultAriaLabel()
    });

    this.applyTheme();

    this.editor.onDidChangeModelContent(() => {
      if (this.suppressValueEmit || !this.editor) {
        return;
      }

      const nextValue = this.editor.getValue();
      this.zone.run(() => this.valueChange.emit(nextValue));
    });

    this.editor.onDidBlurEditorText(() => {
      this.zone.run(() => this.blur.emit());
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.editor?.layout();
    });
    this.resizeObserver.observe(host);

    this.themeObserver = new MutationObserver(() => {
      this.applyTheme();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value'] && this.editor) {
      const nextValue = this.value();
      if (nextValue !== this.editor.getValue()) {
        this.suppressValueEmit = true;
        this.editor.setValue(nextValue);
        this.suppressValueEmit = false;
      }
    }

    if (changes['disabled'] && this.editor) {
      this.editor.updateOptions({ readOnly: this.disabled() });
    }

    if (changes['placeholder'] && this.editor) {
      this.editor.updateOptions({
        ariaLabel: this.placeholder() || this.defaultAriaLabel()
      });
    }

    if (changes['language'] && this.monaco && this.model && this.editor) {
      const language = this.language();
      this.monaco.editor.setModelLanguage(this.model, language);
      this.editor.updateOptions({
        formatOnPaste: language === 'json',
        formatOnType: language === 'json',
        ariaLabel: this.placeholder() || this.defaultAriaLabel()
      });
    }
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.editor?.dispose();
    this.model?.dispose();
  }

  private applyTheme(): void {
    const isDarkTheme = document.documentElement.dataset['theme'] === 'dark';
    this.monaco?.editor.setTheme(isDarkTheme ? 'vs-dark' : 'vs');
  }

  protected editorStyle(): Record<string, string> {
    return {
      minHeight: this.minHeight(),
      maxHeight: this.maxHeight(),
      height: `clamp(${this.minHeight()}, 34vh, ${this.maxHeight()})`
    };
  }

  private defaultAriaLabel(): string {
    return this.language() === 'json' ? 'JSON editor' : 'Text editor';
  }
}
