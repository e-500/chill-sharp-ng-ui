import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChillSchemaListItem } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceService } from '../services/workspace.service';

interface CrudSchemaOption {
  module: string;
  chillType: string;
  displayName: string;
  viewCode: string;
}

@Component({
  selector: 'app-workspace-menu',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="workspace-menu">
      <div class="workspace-menu__header">
        <p class="eyebrow">Workspace menu</p>
        <h2>Tasks</h2>
        <p>Task navigation lives here. The menu structure can be expanded later without changing the shell.</p>
      </div>

      <section class="workspace-menu__crud-launcher">
        <div class="workspace-menu__section-heading">
          <strong>Open CRUD task</strong>
          <span>Select a module and type, then confirm the view code.</span>
        </div>

        @if (schemaLoadError()) {
          <p class="workspace-menu__status error">{{ schemaLoadError() }}</p>
        } @else if (isLoadingSchemas()) {
          <p class="workspace-menu__status">Loading CRUD types...</p>
        }

        <label class="workspace-menu__field">
          <span>Module</span>
          <select
            [ngModel]="selectedModule()"
            (ngModelChange)="selectModule($event)"
            [disabled]="isLoadingSchemas() || moduleOptions().length === 0">
            @for (module of moduleOptions(); track module) {
              <option [value]="module">{{ module }}</option>
            }
          </select>
        </label>

        <label class="workspace-menu__field">
          <span>Type</span>
          <select
            [ngModel]="selectedChillType()"
            (ngModelChange)="selectedChillType.set($event)"
            [disabled]="isLoadingSchemas() || filteredCrudTypes().length === 0">
            @for (schema of filteredCrudTypes(); track schema.chillType) {
              <option [value]="schema.chillType">{{ schema.displayName }} ({{ schema.viewCode }})</option>
            }
          </select>
        </label>

        <label class="workspace-menu__field">
          <span>View code</span>
          <input
            type="text"
            [ngModel]="viewCode()"
            (ngModelChange)="viewCode.set(normalizeViewCode($event))"
            placeholder="default" />
        </label>

        <button
          type="button"
          class="workspace-menu__item workspace-menu__item--launch"
          (click)="openCrudTask()"
          [disabled]="!selectedCrudSchema()">
          <strong>Open CRUD</strong>
          <span>{{ selectedCrudSchema()?.displayName || 'Choose a type to create a CRUD task.' }}</span>
        </button>
      </section>

      <nav class="workspace-menu__list">
        @for (task of quickTasks(); track task.id) {
          <button
            type="button"
            class="workspace-menu__item"
            [class.active]="workspace.activeTask()?.definitionId === task.id"
            (click)="workspace.openTask(task.id)">
            <strong>{{ task.title }}</strong>
            <span>{{ task.description }}</span>
          </button>
        }
      </nav>
    </div>
  `
})
export class WorkspaceMenuComponent implements OnInit {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly isLoadingSchemas = signal(true);
  readonly schemaLoadError = signal('');
  readonly crudTypes = signal<CrudSchemaOption[]>([]);
  readonly selectedModule = signal('');
  readonly selectedChillType = signal('');
  readonly viewCode = signal('default');
  readonly quickTasks = computed(() => this.workspace.availableTasks.filter((task) => task.id !== 'crud'));
  readonly moduleOptions = computed(() => [...new Set(this.crudTypes().map((schema) => schema.module))]);
  readonly filteredCrudTypes = computed(() => this.crudTypes()
    .filter((schema) => schema.module === this.selectedModule()));
  readonly selectedCrudSchema = computed(() => this.filteredCrudTypes()
    .find((schema) => schema.chillType === this.selectedChillType()) ?? null);

  ngOnInit(): void {
    this.loadCrudTypes();
  }

  selectModule(module: string): void {
    this.selectedModule.set(module);
    const firstSchema = this.filteredCrudTypes()[0] ?? null;
    this.selectedChillType.set(firstSchema?.chillType ?? '');
  }

  openCrudTask(): void {
    const schema = this.selectedCrudSchema();
    if (!schema) {
      return;
    }

    this.workspace.openCrudTask({
      chillType: schema.chillType,
      viewCode: this.normalizeViewCode(this.viewCode()),
      displayName: schema.displayName
    });
  }

  normalizeViewCode(value: string): string {
    const normalizedValue = value.trim();
    return normalizedValue ? normalizedValue : 'default';
  }

  private loadCrudTypes(): void {
    this.isLoadingSchemas.set(true);
    this.schemaLoadError.set('');

    this.chill.getSchemaList().subscribe({
      next: (schemaList) => {
        const crudTypes = schemaList
          .filter((schema) => this.isQuerySchema(schema))
          .map((schema) => this.toCrudSchemaOption(schema))
          .sort((left, right) => left.displayName.localeCompare(right.displayName));

        this.crudTypes.set(crudTypes);
        this.isLoadingSchemas.set(false);

        const firstModule = crudTypes[0]?.module ?? '';
        this.selectedModule.set(firstModule);
        const firstSchema = crudTypes.find((schema) => schema.module === firstModule) ?? null;
        this.selectedChillType.set(firstSchema?.chillType ?? '');
      },
      error: (error: unknown) => {
        this.crudTypes.set([]);
        this.schemaLoadError.set(this.chill.formatError(error));
        this.isLoadingSchemas.set(false);
      }
    });
  }

  private isQuerySchema(item: ChillSchemaListItem): boolean {
    const type = item.type?.trim().toLowerCase() ?? '';
    const name = item.name?.trim().toLowerCase() ?? '';
    const chillType = item.chillType?.trim().toLowerCase() ?? '';

    return type === 'query'
      || name.endsWith('query')
      || chillType.includes('.query.')
      || chillType.endsWith('.query');
  }

  private toCrudSchemaOption(schema: ChillSchemaListItem): CrudSchemaOption {
    const chillType = schema.chillType?.trim() ?? '';
    return {
      module: schema.module?.trim() || chillType.split('.')[0] || 'Default',
      chillType,
      displayName: schema.displayName?.trim() || schema.name?.trim() || chillType,
      viewCode: schema.chillViewCode?.trim() || 'default'
    };
  }
}
