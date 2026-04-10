import { CommonModule } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface AuthSearchSelectOption {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
}

@Component({
  selector: 'app-auth-search-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-search-select">
      @if (selectedOption(); as option) {
        <div class="auth-search-select__selected" [title]="option.label">
          <span class="auth-search-select__selected-label">{{ option.label }}</span>
          @if (option.description) {
            <span class="auth-search-select__selected-description">{{ option.description }}</span>
          }
          <button
            type="button"
            class="auth-search-select__clear"
            (click)="clearSelection()"
            [attr.aria-label]="clearAriaLabel()">
            X
          </button>
        </div>
      } @else {
        <div class="auth-search-select__lookup">
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="updateSearchTerm($event)"
            (focus)="openResults()"
            (blur)="closeResultsSoon()"
            [placeholder]="placeholder()" />

          @if (isOpen()) {
            <div class="auth-search-select__results" role="listbox">
              @for (option of filteredOptions(); track option.id) {
                <button
                  type="button"
                  class="auth-search-select__result"
                  (mousedown)="$event.preventDefault()"
                  (click)="selectOption(option.id)">
                  <strong>{{ option.label }}</strong>
                  @if (option.description) {
                    <small>{{ option.description }}</small>
                  }
                </button>
              } @empty {
                <div class="auth-search-select__empty">
                  {{ searchTerm().trim() ? noResultsMessage() : emptyMessage() }}
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .auth-search-select,
    .auth-search-select__lookup {
      position: relative;
    }

    .auth-search-select__lookup input,
    .auth-search-select__selected {
      width: 100%;
      min-height: 3rem;
      border-radius: 0.85rem;
      border: 1px solid var(--border-color);
      background: rgba(255, 255, 255, 0.92);
      color: var(--text-main);
      font: inherit;
    }

    .auth-search-select__lookup input {
      padding: 0.85rem 1rem;
    }

    .auth-search-select__selected {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.45rem 0.5rem 0.45rem 1rem;
    }

    .auth-search-select__selected-label,
    .auth-search-select__selected-description {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .auth-search-select__selected-label {
      font-weight: 700;
      flex: 1 1 auto;
    }

    .auth-search-select__selected-description {
      color: var(--text-muted);
      flex: 0 1 auto;
    }

    .auth-search-select__clear {
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 999px;
      background: rgba(35, 48, 73, 0.1);
      color: var(--text-main);
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      flex: 0 0 auto;
    }

    .auth-search-select__results {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 0.35rem);
      z-index: 10;
      display: grid;
      gap: 0.35rem;
      max-height: 18rem;
      padding: 0.45rem;
      overflow: auto;
      border-radius: 0.9rem;
      border: 1px solid var(--border-color);
      background: var(--surface-0);
      box-shadow: var(--shadow);
    }

    .auth-search-select__result,
    .auth-search-select__empty {
      display: grid;
      gap: 0.2rem;
      padding: 0.7rem 0.8rem;
      border-radius: 0.75rem;
    }

    .auth-search-select__result {
      border: 0;
      background: transparent;
      color: var(--text-main);
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .auth-search-select__result:hover {
      background: rgba(35, 48, 73, 0.08);
    }

    .auth-search-select__result small,
    .auth-search-select__empty {
      color: var(--text-muted);
    }
  `
})
export class AuthSearchSelectComponent {
  readonly options = input<AuthSearchSelectOption[]>([]);
  readonly selectedId = input('');
  readonly placeholder = input('Search and select');
  readonly emptyMessage = input('Start typing to search.');
  readonly noResultsMessage = input('No matches found.');
  readonly clearAriaLabel = input('Clear selection');
  readonly selectionChange = output<string>();

  readonly searchTerm = signal('');
  readonly isOpen = signal(false);

  readonly selectedOption = computed(() =>
    this.options().find((option) => option.id === this.selectedId()) ?? null
  );

  readonly filteredOptions = computed(() => {
    const query = this.searchTerm().trim().toLowerCase();
    if (!query) {
      return this.options();
    }

    return this.options().filter((option) => {
      const haystack = [
        option.label,
        option.description,
        option.keywords
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  });

  updateSearchTerm(value: string): void {
    this.searchTerm.set(value);
    this.isOpen.set(true);
  }

  openResults(): void {
    this.isOpen.set(true);
  }

  closeResultsSoon(): void {
    window.setTimeout(() => {
      this.isOpen.set(false);
    }, 120);
  }

  selectOption(id: string): void {
    this.searchTerm.set('');
    this.isOpen.set(false);
    this.selectionChange.emit(id);
  }

  clearSelection(): void {
    this.searchTerm.set('');
    this.isOpen.set(false);
    this.selectionChange.emit('');
  }
}
