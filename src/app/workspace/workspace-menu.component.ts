import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ChillMenuItem } from '../models/chill-menu.models';
import type { ChillSchemaListItem } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';
import { WorkspaceService } from '../services/workspace.service';

interface CrudSchemaOption {
  module: string;
  chillType: string;
  displayName: string;
  viewCode: string;
}

interface WorkspaceMenuNode {
  item: ChillMenuItem;
  children: WorkspaceMenuNode[];
  childrenLoaded: boolean;
  isExpanded: boolean;
  isLoadingChildren: boolean;
  childrenError: string;
  hasChildren: boolean;
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

      <section class="workspace-menu__managed-menu">
        <div class="workspace-menu__section-heading workspace-menu__section-heading--row">
          <div>
            <strong>{{ chill.T('F0E48F17-2E1F-43CC-A37F-21A503E7A1BF', 'Application menu', 'Menu applicazione') }}</strong>
            <span>{{ chill.T('D7D35597-D998-4892-9288-4FC4B48C53A9', 'Root nodes are loaded first; child branches are prepared lazily.', 'I nodi radice sono caricati per primi; i rami figli sono preparati in modo lazy.') }}</span>
          </div>

          @if (layout.isLayoutEditingEnabled()) {
            <button type="button" class="workspace-menu__item workspace-menu__item--compact" (click)="createMenuItem(null)">
              {{ chill.T('9CC0E7F1-D5E2-4A0F-B3BF-E11FB31C26D4', 'Add root item', 'Aggiungi nodo radice') }}
            </button>
          }
        </div>

        @if (menuLoadError()) {
          <p class="workspace-menu__status error">{{ menuLoadError() }}</p>
        } @else if (isLoadingMenu()) {
          <p class="workspace-menu__status">{{ chill.T('E5B9FD29-47DA-40A6-810C-85BC6241D07A', 'Loading menu...', 'Caricamento menu...') }}</p>
        } @else if (menuRoots().length === 0) {
          <p class="workspace-menu__status">{{ chill.T('96C1B2E5-D6CA-4C53-8353-D97D4F8E0B09', 'No menu items are available for the current user.', 'Nessuna voce menu disponibile per l&apos;utente corrente.') }}</p>
        } @else {
          <nav class="workspace-menu__tree" aria-label="Application menu">
            @for (node of menuRoots(); track node.item.guid) {
              <ng-container [ngTemplateOutlet]="treeNode" [ngTemplateOutletContext]="{ $implicit: node, depth: 0 }" />
            }
          </nav>
        }
      </section>

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

      <ng-template #treeNode let-node let-depth="depth">
        <div class="workspace-menu__tree-node" [style.--menu-depth]="depth">
          <div class="workspace-menu__tree-row">
            <div class="workspace-menu__tree-main">
              <button
                type="button"
                class="workspace-menu__tree-expander"
                [disabled]="!node.hasChildren && !node.isLoadingChildren"
                [class.is-placeholder]="!node.hasChildren && !node.isLoadingChildren"
                (click)="toggleNode(node)"
                [attr.aria-label]="node.isExpanded
                  ? chill.T('3E81EBAA-9CF7-4259-BCA8-483D30FC0A93', 'Collapse menu branch', 'Comprimi ramo menu')
                  : chill.T('D2EEB263-B9CA-4C31-910B-BB9C5DC585DF', 'Expand menu branch', 'Espandi ramo menu')">
                @if (node.isLoadingChildren) {
                  <span>...</span>
                } @else if (node.hasChildren) {
                  <span>{{ node.isExpanded ? '-' : '+' }}</span>
                } @else {
                  <span></span>
                }
              </button>

              <button
                type="button"
                class="workspace-menu__tree-trigger"
                [class.active]="isMenuTaskActive(node.item)"
                (click)="openMenuItem(node.item)">
                <strong>{{ node.item.title }}</strong>
                @if (node.item.description) {
                  <span>{{ node.item.description }}</span>
                } @else {
                  <span>{{ node.item.componentName }}</span>
                }
              </button>
            </div>

            @if (layout.isLayoutEditingEnabled()) {
              <div class="workspace-menu__tree-actions">
                <button type="button" class="workspace-menu__tree-action" (click)="createMenuItem(node.item)">
                  {{ chill.T('918FE5BA-CF28-4A7E-BDD8-E9546CC53A67', 'Add child', 'Aggiungi figlio') }}
                </button>
                <button type="button" class="workspace-menu__tree-action" (click)="editMenuItem(node.item)">
                  {{ chill.T('6E9A69C0-C4A1-433A-97BC-9E8D1CBD2B53', 'Edit', 'Modifica') }}
                </button>
                <button type="button" class="workspace-menu__tree-action" (click)="deleteMenuItem(node.item)">
                  {{ chill.T('0D13D4B2-4D2B-4D17-9A89-C30979DA24D5', 'Delete', 'Elimina') }}
                </button>
              </div>
            }
          </div>

          @if (node.childrenError) {
            <p class="workspace-menu__status error workspace-menu__status--nested">{{ node.childrenError }}</p>
          }

          @if (node.isExpanded && node.children.length > 0) {
            <div class="workspace-menu__tree-children">
              @for (child of node.children; track child.item.guid) {
                <ng-container [ngTemplateOutlet]="treeNode" [ngTemplateOutletContext]="{ $implicit: child, depth: depth + 1 }" />
              }
            </div>
          }
        </div>
      </ng-template>
    </div>
  `
})
export class WorkspaceMenuComponent implements OnInit {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly layout = inject(WorkspaceLayoutService);
  readonly isLoadingSchemas = signal(true);
  readonly schemaLoadError = signal('');
  readonly crudTypes = signal<CrudSchemaOption[]>([]);
  readonly selectedModule = signal('');
  readonly selectedChillType = signal('');
  readonly viewCode = signal('default');
  readonly isLoadingMenu = signal(true);
  readonly menuLoadError = signal('');
  readonly menuRoots = signal<WorkspaceMenuNode[]>([]);
  readonly quickTasks = computed(() => this.workspace.availableTasks.filter((task) => task.id !== 'crud'));
  readonly moduleOptions = computed(() => [...new Set(this.crudTypes().map((schema) => schema.module))]);
  readonly filteredCrudTypes = computed(() => this.crudTypes()
    .filter((schema) => schema.module === this.selectedModule()));
  readonly selectedCrudSchema = computed(() => this.filteredCrudTypes()
    .find((schema) => schema.chillType === this.selectedChillType()) ?? null);

  ngOnInit(): void {
    this.loadCrudTypes();
    void this.loadRootMenu();
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

  toggleNode(node: WorkspaceMenuNode): void {
    if (!node.hasChildren && !node.isLoadingChildren) {
      return;
    }

    if (!node.childrenLoaded && !node.isLoadingChildren) {
      void this.loadNodeChildren(node, true);
      return;
    }

    this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
      ...current,
      isExpanded: !current.isExpanded
    })));
  }

  openMenuItem(item: ChillMenuItem): void {
    const componentName = item.componentName.trim().toLowerCase();
    const configuration = this.parseMenuConfiguration(item.componentConfigurationJson);

    if (componentName === 'crud') {
      const chillType = this.readConfigString(configuration, ['ChillType', 'chillType', 'Type', 'type']);
      if (!chillType) {
        return;
      }

      this.workspace.openCrudTask({
        chillType,
        viewCode: this.readConfigString(configuration, ['ViewCode', 'viewCode']) || 'default',
        displayName: item.title
      });
      return;
    }

    if (componentName === 'permissions' || componentName === 'permission' || componentName === 'permission-page') {
      this.workspace.openWorkspaceTask({
        taskId: 'permissions',
        title: item.title,
        description: item.description
      });
      return;
    }

    if (componentName === 'eventviewer' || componentName === 'event-viewer' || componentName === 'events') {
      this.workspace.openWorkspaceTask({
        taskId: 'event-viewer',
        title: item.title,
        description: item.description
      });
    }
  }

  isMenuTaskActive(item: ChillMenuItem): boolean {
    const activeTask = this.workspace.activeTask();
    if (!activeTask) {
      return false;
    }

    const componentName = item.componentName.trim().toLowerCase();
    if (componentName === 'crud') {
      const configuration = this.parseMenuConfiguration(item.componentConfigurationJson);
      const chillType = this.readConfigString(configuration, ['ChillType', 'chillType', 'Type', 'type']);
      const viewCode = this.readConfigString(configuration, ['ViewCode', 'viewCode']) || 'default';
      return activeTask.id === `crud:${chillType}:${viewCode}`;
    }

    if (componentName === 'permissions' || componentName === 'permission' || componentName === 'permission-page') {
      return activeTask.definitionId === 'permissions';
    }

    if (componentName === 'eventviewer' || componentName === 'event-viewer' || componentName === 'events') {
      return activeTask.definitionId === 'event-viewer';
    }

    return false;
  }

  async createMenuItem(parent: ChillMenuItem | null): Promise<void> {
    await this.editOrCreateMenuItem(null, parent);
  }

  async editMenuItem(item: ChillMenuItem): Promise<void> {
    await this.editOrCreateMenuItem(item, item.parent);
  }

  async deleteMenuItem(item: ChillMenuItem): Promise<void> {
    const confirmed = await this.dialog.confirmYesNo(
      this.chill.T('601728DD-B38F-4B1D-B3AC-4B4BC2A49D6B', 'Delete menu item', 'Elimina voce di menu'),
      this.chill.T(
        '0B714FA0-6F35-4C99-8C0C-C5EC2955B5B5',
        `Delete "${item.title}" from the application menu?`,
        `Eliminare "${item.title}" dal menu applicazione?`
      )
    );

    if (!confirmed) {
      return;
    }

    await firstValueFrom(this.chill.deleteMenu(item.guid));
    await this.refreshMenuBranch(item.parent?.guid ?? null);
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

  private async loadRootMenu(): Promise<void> {
    this.isLoadingMenu.set(true);
    this.menuLoadError.set('');

    try {
      const items = await firstValueFrom(this.chill.getMenu());
      const roots = items.map((item) => this.createNode(item));
      this.menuRoots.set(roots);
      this.isLoadingMenu.set(false);
      await Promise.all(roots.map((node) => this.preloadNodeChildren(node)));
    } catch (error) {
      this.menuRoots.set([]);
      this.menuLoadError.set(this.chill.formatError(error));
      this.isLoadingMenu.set(false);
    }
  }

  private async preloadNodeChildren(node: WorkspaceMenuNode): Promise<void> {
    if (!node.item.guid.trim()) {
      return;
    }

    this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
      ...current,
      isLoadingChildren: true,
      childrenError: ''
    })));

    try {
      const children = await firstValueFrom(this.chill.getMenu(node.item.guid));
      const childNodes = children.map((item) => this.createNode(item));
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
        ...current,
        children: childNodes,
        childrenLoaded: true,
        isLoadingChildren: false,
        hasChildren: childNodes.length > 0
      })));
    } catch (error) {
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
        ...current,
        childrenLoaded: false,
        isLoadingChildren: false,
        hasChildren: false,
        childrenError: this.chill.formatError(error)
      })));
    }
  }

  private async loadNodeChildren(node: WorkspaceMenuNode, expandAfterLoad: boolean): Promise<void> {
    this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
      ...current,
      isLoadingChildren: true,
      childrenError: ''
    })));

    try {
      const children = await firstValueFrom(this.chill.getMenu(node.item.guid));
      const childNodes = children.map((item) => this.createNode(item));
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
        ...current,
        children: childNodes,
        childrenLoaded: true,
        isExpanded: expandAfterLoad,
        isLoadingChildren: false,
        hasChildren: childNodes.length > 0
      })));
      await Promise.all(childNodes.map((child) => this.preloadNodeChildren(child)));
    } catch (error) {
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
        ...current,
        childrenLoaded: false,
        isLoadingChildren: false,
        hasChildren: false,
        childrenError: this.chill.formatError(error)
      })));
    }
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

  private createNode(item: ChillMenuItem): WorkspaceMenuNode {
    return {
      item,
      children: [],
      childrenLoaded: false,
      isExpanded: false,
      isLoadingChildren: false,
      childrenError: '',
      hasChildren: false
    };
  }

  private updateNodeCollection(
    nodes: WorkspaceMenuNode[],
    targetGuid: string,
    updater: (node: WorkspaceMenuNode) => WorkspaceMenuNode
  ): WorkspaceMenuNode[] {
    return nodes.map((node) => {
      if (node.item.guid === targetGuid) {
        return updater(node);
      }

      if (node.children.length === 0) {
        return node;
      }

      const nextChildren = this.updateNodeCollection(node.children, targetGuid, updater);
      return nextChildren === node.children
        ? node
        : {
            ...node,
            children: nextChildren
          };
    });
  }

  private async editOrCreateMenuItem(item: ChillMenuItem | null, parent: ChillMenuItem | null): Promise<void> {
    const { WorkspaceMenuItemDialogComponent } = await import('./workspace-menu-item-dialog.component');
    const result = await this.dialog.openDialog<{ value: ChillMenuItem }>({
      title: item
        ? this.chill.T('35B8C58D-45AB-47D9-BDC0-6A7D3686981E', 'Edit menu item', 'Modifica voce di menu')
        : this.chill.T('4B47BBA2-8823-4629-BE14-B9B374F8C6F1', 'New menu item', 'Nuova voce di menu'),
      component: WorkspaceMenuItemDialogComponent,
      inputs: { item, parent },
      okLabel: this.chill.T('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Save', 'Salva')
    });

    if (result.status !== 'confirmed' || !result.value?.value) {
      return;
    }

    // Set guid if missing
    if (!result.value?.value?.guid || result.value?.value?.guid === "")
      result.value.value.guid = crypto.randomUUID();

    const savedItem = await firstValueFrom(this.chill.setMenu(result.value.value));
    await this.refreshMenuBranch(savedItem.parent?.guid ?? null);
  }

  private async refreshMenuBranch(parentGuid: string | null): Promise<void> {
    if (!parentGuid) {
      await this.loadRootMenu();
      return;
    }

    try {
      const children = await firstValueFrom(this.chill.getMenu(parentGuid));
      const childNodes = children.map((item) => this.createNode(item));
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, parentGuid, (current) => ({
        ...current,
        children: childNodes,
        childrenLoaded: true,
        isExpanded: true,
        isLoadingChildren: false,
        hasChildren: childNodes.length > 0,
        childrenError: ''
      })));
      await Promise.all(childNodes.map((child) => this.preloadNodeChildren(child)));
    } catch (error) {
      this.menuRoots.update((roots) => this.updateNodeCollection(roots, parentGuid, (current) => ({
        ...current,
        childrenError: this.chill.formatError(error),
        isLoadingChildren: false
      })));
    }
  }

  private parseMenuConfiguration(value: string | null): Record<string, unknown> | null {
    if (!value?.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }

  private readConfigString(
    configuration: Record<string, unknown> | null,
    keys: string[]
  ): string {
    if (!configuration) {
      return '';
    }

    for (const key of keys) {
      const value = configuration[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    const normalizedKeys = keys.map((key) => key.toLowerCase());
    for (const [key, value] of Object.entries(configuration)) {
      if (typeof value === 'string' && value.trim() && normalizedKeys.includes(key.toLowerCase())) {
        return value.trim();
      }
    }

    return '';
  }
}
