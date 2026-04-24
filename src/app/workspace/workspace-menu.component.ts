import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { applySchemaRelationsToCrudConfiguration } from '../lib/crud-configuration.utils';
import type { ChillMenuItem } from '../models/chill-menu.models';
import type { ChillSchema, ChillSchemaListItem } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';
import { WorkspaceService } from '../services/workspace.service';

interface CrudSchemaOption {
  module: string;
  chillType: string;
  queryChillType: string;
  displayName: string;
  viewCode: string;
}

interface EntityOptionsSchemaOption {
  module: string;
  chillType: string;
  displayName: string;
  kind: 'Entity' | 'Query';
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
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
  `,
  template: `
    <div class="workspace-menu">
      <div class="workspace-menu__header">
        <p class="eyebrow">Workspace menu</p>
        <h2>Tasks</h2>
        <!-- <p>Task navigation lives here. The menu structure can be expanded later without changing the shell.</p> -->
      </div>

      <section class="workspace-menu__managed-menu">
        <div class="workspace-menu__section-heading workspace-menu__section-heading--row">
          <div>
            <strong>{{ chill.T('F0E48F17-2E1F-43CC-A37F-21A503E7A1BF', 'Application menu', 'Menu applicazione') }}</strong>
            <!-- <span>{{ chill.T('D7D35597-D998-4892-9288-4FC4B48C53A9', 'Root nodes are loaded first; child branches are prepared lazily.', 'I nodi radice sono caricati per primi; i rami figli sono preparati in modo lazy.') }}</span> -->
          </div>
        </div>

        @if (menuLoadError()) {
          <p class="workspace-menu__status error">{{ menuLoadError() }}</p>
        } @else if (isLoadingMenu()) {
          <p class="workspace-menu__status">{{ chill.T('E5B9FD29-47DA-40A6-810C-85BC6241D07A', 'Loading menu...', 'Caricamento menu...') }}</p>
        } @else if (menuRoots().length === 0) {
          <p class="workspace-menu__status">{{ chill.T('96C1B2E5-D6CA-4C53-8353-D97D4F8E0B09', 'No menu items are available for the current user.', "Nessuna voce menu disponibile per l'utente corrente.") }}</p>
        } @else {
          <nav class="workspace-menu__tree" aria-label="Application menu">
            <ng-container
              [ngTemplateOutlet]="treeCollection"
              [ngTemplateOutletContext]="{ nodes: menuRoots(), depth: 0, parent: null }" />
          </nav>
        }

        @if (layout.isLayoutEditingEnabled()) {
          <button
            type="button"
            class="workspace-menu__item workspace-menu__item--compact workspace-menu__root-action"
            (click)="createMenuItem(null)">
            {{ chill.T('9CC0E7F1-D5E2-4A0F-B3BF-E11FB31C26D4', 'Add root item', 'Aggiungi nodo radice') }}
          </button>
        }
      </section>

      @if (layout.isLayoutEditingEnabled()) {
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
                <option [value]="schema.chillType">{{ schema.displayName }} ({{ schema.chillType }})</option>
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

          <button
            type="button"
            class="workspace-menu__item workspace-menu__item--launch"
            (click)="addCrudTaskToMenu()"
            [disabled]="!selectedCrudSchema()">
            <strong>Add to menu</strong>
            <span>{{ selectedCrudSchema()?.displayName || 'Choose a type to add it to the application menu.' }}</span>
          </button>
        </section>

        <section class="workspace-menu__crud-launcher">
          <div class="workspace-menu__section-heading">
            <strong>Entity option</strong>
            <span>Select a model and type, including query types, then configure its options.</span>
          </div>

          @if (schemaLoadError()) {
            <p class="workspace-menu__status error">{{ schemaLoadError() }}</p>
          } @else if (isLoadingSchemas()) {
            <p class="workspace-menu__status">Loading types...</p>
          }

          <label class="workspace-menu__field">
            <span>Model</span>
            <select
              [ngModel]="selectedEntityOptionsModule()"
              (ngModelChange)="selectEntityOptionsModule($event)"
              [disabled]="isLoadingSchemas() || entityOptionsModuleOptions().length === 0">
              @for (module of entityOptionsModuleOptions(); track module) {
                <option [value]="module">{{ module }}</option>
              }
            </select>
          </label>

          <label class="workspace-menu__field">
            <span>Type</span>
            <select
              [ngModel]="selectedEntityOptionsChillType()"
              (ngModelChange)="selectedEntityOptionsChillType.set($event)"
              [disabled]="isLoadingSchemas() || filteredEntityOptionsTypes().length === 0">
              @for (schema of filteredEntityOptionsTypes(); track schema.chillType) {
                <option [value]="schema.chillType">{{ schema.displayName }} ({{ schema.kind }}: {{ schema.chillType }})</option>
              }
            </select>
          </label>

          <button
            type="button"
            class="workspace-menu__item workspace-menu__item--launch"
            (click)="openEntityOptionsDialog()"
            [disabled]="!selectedEntityOptionsSchema()">
            <strong>Configure</strong>
            <span>{{ selectedEntityOptionsSchema()?.displayName || 'Choose a type to configure its options.' }}</span>
          </button>
        </section>
      }

      <!-- <nav class="workspace-menu__list">
        @for (task of quickTasks(); track task.componentName) {
          <button
            type="button"
            class="workspace-menu__item"
            [class.active]="workspace.activeTask()?.taskType === task.componentName"
            (click)="openQuickTask(task.componentName)">
            <strong>{{ task.title }}</strong>
            <span>{{ task.description }}</span>
          </button>
        }
      </nav> -->

      <ng-template #treeCollection let-nodes="nodes" let-depth="depth" let-parent="parent">
        @for (node of nodes; track node.item.guid; let index = $index) {
          @if (layout.isLayoutEditingEnabled()) {
            <div
              class="workspace-menu__drop-zone"
              [style.--menu-depth]="depth"
              [class.is-active]="isDropTarget(parent, index)"
              (dragover)="allowMenuDrop($event)"
              (drop)="dropMenuItem(parent, index)">
            </div>
          }

          <ng-container [ngTemplateOutlet]="treeNode" [ngTemplateOutletContext]="{ $implicit: node, depth: depth }" />
        }

        @if (layout.isLayoutEditingEnabled()) {
          <div
            class="workspace-menu__drop-zone"
            [style.--menu-depth]="depth"
            [class.is-active]="isDropTarget(parent, nodes.length)"
            (dragover)="allowMenuDrop($event)"
            (drop)="dropMenuItem(parent, nodes.length)">
          </div>
        }
      </ng-template>

      <ng-template #treeNode let-node let-depth="depth">
        <div class="workspace-menu__tree-node" [style.--menu-depth]="depth">
          <div
            class="workspace-menu__tree-row"
            [class.is-dragging]="draggedMenuItemGuid() === node.item.guid"
            [draggable]="layout.isLayoutEditingEnabled()"
            (dragstart)="beginMenuDrag(node.item)"
            (dragend)="endMenuDrag()">
            <div
              class="workspace-menu__tree-main"
              [class.is-active]="isMenuTaskActive(node.item)"
              [class.is-pending-expand]="dragHoverExpandGuid() === node.item.guid"
              (dragover)="allowMenuDrop($event); hoverMenuItem(node)"
              (drop)="dropMenuItemAsChild(node, $event)"
              (dragleave)="leaveMenuItem(node, $event)">
              <div class="workspace-menu__tree-body">
                <button
                  type="button"
                  class="workspace-menu__tree-trigger"
                  [disabled]="node.item.componentName === null || node.item.componentName === ''"
                  (click)="openMenuItem(node.item)">
                  <span class="workspace-menu__tree-label">
                    <strong>{{ node.item.title }}</strong>
                  </span>
                </button>

                @if (layout.isLayoutEditingEnabled()) {
                  <div class="workspace-menu__tree-actions workspace-menu__tree-actions--inline">
                    <button
                      type="button"
                      class="workspace-menu__tree-action"
                      [attr.aria-label]="chill.T('918FE5BA-CF28-4A7E-BDD8-E9546CC53A67', 'Add child', 'Aggiungi figlio')"
                      [title]="chill.T('918FE5BA-CF28-4A7E-BDD8-E9546CC53A67', 'Add child', 'Aggiungi figlio')"
                      (click)="createMenuItem(node.item)">
                      <span class="material-symbol-icon" aria-hidden="true">add</span>
                    </button>
                    <button
                      type="button"
                      class="workspace-menu__tree-action"
                      [attr.aria-label]="chill.T('6E9A69C0-C4A1-433A-97BC-9E8D1CBD2B53', 'Edit', 'Modifica')"
                      [title]="chill.T('6E9A69C0-C4A1-433A-97BC-9E8D1CBD2B53', 'Edit', 'Modifica')"
                      (click)="editMenuItem(node.item)">
                      <span class="material-symbol-icon" aria-hidden="true">edit</span>
                    </button>
                    <button
                      type="button"
                      class="workspace-menu__tree-action"
                      [attr.aria-label]="chill.T('0D13D4B2-4D2B-4D17-9A89-C30979DA24D5', 'Delete', 'Elimina')"
                      [title]="chill.T('0D13D4B2-4D2B-4D17-9A89-C30979DA24D5', 'Delete', 'Elimina')"
                      (click)="deleteMenuItem(node.item)">
                      <span class="material-symbol-icon" aria-hidden="true">delete</span>
                    </button>
                  </div>
                } @else if (node.isExpanded) {
                  <div class="workspace-menu__tree-meta">
                    @if (node.item.description) {
                      <span>{{ node.item.description }}</span>
                    } @else {
                      <span>{{ node.item.componentName }}</span>
                    }
                  </div>
                }
              </div>

              @if(node.isLoadingChildren || node.hasChildren)
              {
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
                    <span class="workspace-menu__tree-expander-icon material-symbol-icon">more_horiz</span>
                  } @else if (node.hasChildren) {
                    <span class="workspace-menu__tree-expander-icon material-symbol-icon">
                      {{ node.isExpanded ? 'expand_less' : 'expand_more' }}
                    </span>
                  } @else {
                    <span class="workspace-menu__tree-expander-icon material-symbol-icon">chevron_right</span>
                  }
                </button>
              }
            </div>
          </div>

          @if (node.childrenError) {
            <p class="workspace-menu__status error workspace-menu__status--nested">{{ node.childrenError }}</p>
          }

          @if (node.isExpanded && node.children.length > 0) {
            <div class="workspace-menu__tree-children">
              <ng-container
                [ngTemplateOutlet]="treeCollection"
                [ngTemplateOutletContext]="{ nodes: node.children, depth: depth + 1, parent: node.item }" />
            </div>
          }
        </div>
      </ng-template>
    </div>
  `
})
export class WorkspaceMenuComponent implements OnInit, OnDestroy {
  readonly chill = inject(ChillService);
  readonly workspace = inject(WorkspaceService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly layout = inject(WorkspaceLayoutService);
  readonly isLoadingSchemas = signal(true);
  readonly schemaLoadError = signal('');
  readonly crudTypes = signal<CrudSchemaOption[]>([]);
  readonly entityOptionsTypes = signal<EntityOptionsSchemaOption[]>([]);
  readonly selectedModule = signal('');
  readonly selectedChillType = signal('');
  readonly selectedEntityOptionsModule = signal('');
  readonly selectedEntityOptionsChillType = signal('');
  readonly viewCode = signal('default');
  readonly isLoadingMenu = signal(true);
  readonly menuLoadError = signal('');
  readonly menuRoots = signal<WorkspaceMenuNode[]>([]);
  readonly draggedMenuItemGuid = signal('');
  readonly dragHoverExpandGuid = signal('');
  private readonly dragHoverExpandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly quickTasks = computed(() => this.workspace.availableTasks()
    .filter((task) => task.showInQuickLaunch && task.componentName !== 'crud' && task.componentName !== 'permissions'));
  readonly moduleOptions = computed(() => [...new Set(this.crudTypes().map((schema) => schema.module))]);
  readonly filteredCrudTypes = computed(() => this.crudTypes()
    .filter((schema) => schema.module === this.selectedModule()));
  readonly selectedCrudSchema = computed(() => this.filteredCrudTypes()
    .find((schema) => schema.chillType === this.selectedChillType()) ?? null);
  readonly entityOptionsModuleOptions = computed(() => [...new Set(this.entityOptionsTypes().map((schema) => schema.module))]);
  readonly filteredEntityOptionsTypes = computed(() => this.entityOptionsTypes()
    .filter((schema) => schema.module === this.selectedEntityOptionsModule()));
  readonly selectedEntityOptionsSchema = computed(() => this.filteredEntityOptionsTypes()
    .find((schema) => schema.chillType === this.selectedEntityOptionsChillType()) ?? null);

  ngOnInit(): void {
    this.loadCrudTypes();
    void this.loadRootMenu();
  }

  ngOnDestroy(): void {
    this.clearAllDragHoverExpandTimers();
  }

  selectModule(module: string): void {
    this.selectedModule.set(module);
    const firstSchema = this.filteredCrudTypes()[0] ?? null;
    this.selectedChillType.set(firstSchema?.chillType ?? '');
  }

  selectEntityOptionsModule(module: string): void {
    this.selectedEntityOptionsModule.set(module);
    const firstSchema = this.filteredEntityOptionsTypes()[0] ?? null;
    this.selectedEntityOptionsChillType.set(firstSchema?.chillType ?? '');
  }

  openCrudTask(): void {
    const schema = this.selectedCrudSchema();
    if (!schema) {
      return;
    }

    this.workspace.openCrudTask({
      chillType: schema.chillType,
      queryChillType: schema.queryChillType,
      viewCode: this.normalizeViewCode(this.viewCode()),
      displayName: schema.displayName
    });
  }

  async addCrudTaskToMenu(): Promise<void> {
    const schema = this.selectedCrudSchema();
    if (!schema) {
      return;
    }

    try {
      const configuration = await this.buildCrudMenuConfiguration(schema);
      const savedItem = await firstValueFrom(this.chill.setMenu({
        guid: crypto.randomUUID(),
        positionNo: this.menuRoots().length + 1,
        title: schema.displayName || schema.chillType,
        description: `CRUD task for ${schema.chillType}`,
        parent: null,
        componentName: 'crud',
        componentConfigurationJson: JSON.stringify(configuration, null, 2),
        menuHierarchy: schema.module
      }));

      await this.refreshMenuBranch(savedItem.parent?.guid ?? null);
    } catch (error) {
      this.schemaLoadError.set(this.chill.formatError(error));
    }
  }

  async openEntityOptionsDialog(): Promise<void> {
    const schema = this.selectedEntityOptionsSchema();
    if (!schema) {
      return;
    }

    const { EntityOptionsDialogComponent } = await import('./entity-options-dialog.component');
    await this.dialog.openDialog<unknown>({
      title: `${schema.displayName || schema.chillType} entity options`,
      component: EntityOptionsDialogComponent,
      inputs: {
        chillType: schema.chillType,
        displayName: schema.displayName
      },
      okLabel: this.chill.T('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Save', 'Salva')
    });
  }

  openQuickTask(componentName: string): void {
    void this.workspace.openTask(componentName);
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
    void this.workspace.openMenuItem(item);
  }

  beginMenuDrag(item: ChillMenuItem): void {
    if (!this.layout.isLayoutEditingEnabled()) {
      return;
    }

    this.draggedMenuItemGuid.set(item.guid);
  }

  hoverMenuItem(node: WorkspaceMenuNode): void {
    if (!this.layout.isLayoutEditingEnabled() || !this.draggedMenuItemGuid() || node.isExpanded || node.isLoadingChildren) {
      return;
    }

    const draggedGuid = this.draggedMenuItemGuid();
    if (!draggedGuid || draggedGuid === node.item.guid) {
      return;
    }

    const sourceContext = this.findNodeContext(draggedGuid, this.menuRoots(), null);
    if (!sourceContext || this.isDescendantOf(sourceContext.node, node.item.guid)) {
      return;
    }

    if (this.dragHoverExpandTimers.has(node.item.guid)) {
      return;
    }

    this.dragHoverExpandGuid.set(node.item.guid);
    const timer = setTimeout(() => {
      this.dragHoverExpandTimers.delete(node.item.guid);
      this.dragHoverExpandGuid.update((current) => current === node.item.guid ? '' : current);
      void this.expandNodeForHover(node);
    }, 1000);

    this.dragHoverExpandTimers.set(node.item.guid, timer);
  }

  leaveMenuItem(node: WorkspaceMenuNode, event: DragEvent): void {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    this.clearDragHoverExpandTimer(node.item.guid);
  }

  allowMenuDrop(event: DragEvent): void {
    if (!this.layout.isLayoutEditingEnabled() || !this.draggedMenuItemGuid()) {
      return;
    }

    event.preventDefault();
  }

  async dropMenuItem(parent: ChillMenuItem | null, targetIndex: number): Promise<void> {
    const sourceGuid = this.draggedMenuItemGuid();
    this.draggedMenuItemGuid.set('');
    this.clearAllDragHoverExpandTimers();

    if (!sourceGuid) {
      return;
    }

    const sourceContext = this.findNodeContext(sourceGuid, this.menuRoots(), null);
    if (!sourceContext) {
      return;
    }

    if (parent && (parent.guid === sourceGuid || this.isDescendantOf(sourceContext.node, parent.guid))) {
      return;
    }

    const sourceParentGuid = sourceContext.parent?.item.guid ?? null;
    const targetParentGuid = parent?.guid ?? null;
    const sourceSiblings = [...sourceContext.siblings];
    const targetSiblings = sourceParentGuid === targetParentGuid
      ? sourceSiblings
      : [...(this.findChildCollection(targetParentGuid) ?? [])];

    if (sourceParentGuid !== targetParentGuid && !this.findChildCollection(targetParentGuid)) {
      return;
    }

    const [movedNode] = sourceSiblings.splice(sourceContext.index, 1);
    if (!movedNode) {
      return;
    }

    const normalizedTargetIndex = sourceParentGuid === targetParentGuid && sourceContext.index < targetIndex
      ? targetIndex - 1
      : targetIndex;
    const boundedTargetIndex = Math.max(0, Math.min(normalizedTargetIndex, targetSiblings.length));

    if (sourceParentGuid === targetParentGuid && boundedTargetIndex === sourceContext.index) {
      return;
    }

    const movedParent = parent ? this.toParentReference(parent) : null;
    targetSiblings.splice(boundedTargetIndex, 0, {
      ...movedNode,
      item: {
        ...movedNode.item,
        parent: movedParent
      }
    });

    const itemsToSave = sourceParentGuid === targetParentGuid
      ? this.reindexMenuItems(targetSiblings, movedParent)
      : [
          ...this.reindexMenuItems(
            sourceSiblings,
            sourceContext.parent ? this.toParentReference(sourceContext.parent.item) : null
          ),
          ...this.reindexMenuItems(targetSiblings, movedParent)
        ];

    for (const item of itemsToSave) {
      await firstValueFrom(this.chill.setMenu(item));
    }

    await this.loadRootMenu();
  }

  async dropMenuItemAsChild(node: WorkspaceMenuNode, event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await this.dropMenuItem(node.item, node.children.length);
  }

  endMenuDrag(): void {
    this.draggedMenuItemGuid.set('');
    this.clearAllDragHoverExpandTimers();
  }

  isDropTarget(parent: ChillMenuItem | null, targetIndex: number): boolean {
    const draggedGuid = this.draggedMenuItemGuid();
    if (!draggedGuid) {
      return false;
    }

    const sourceContext = this.findNodeContext(draggedGuid, this.menuRoots(), null);
    if (!sourceContext) {
      return false;
    }

    const sourceParentGuid = sourceContext.parent?.item.guid ?? null;
    const targetParentGuid = parent?.guid ?? null;
    const normalizedTargetIndex = sourceParentGuid === targetParentGuid && sourceContext.index < targetIndex
      ? targetIndex - 1
      : targetIndex;

    return sourceParentGuid === targetParentGuid && normalizedTargetIndex === sourceContext.index;
  }

  isMenuTaskActive(item: ChillMenuItem): boolean {
    return this.workspace.isMenuItemActive(item);
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
        const entityOptionsTypes = schemaList
          .map((schema) => this.toEntityOptionsSchemaOption(schema))
          .filter((schema): schema is EntityOptionsSchemaOption => schema !== null)
          .filter((schema, index, options) => index === options.findIndex((option) =>
            option.module === schema.module && option.chillType === schema.chillType
          ))
          .sort((left, right) => left.displayName.localeCompare(right.displayName));

        this.crudTypes.set(crudTypes);
        this.entityOptionsTypes.set(entityOptionsTypes);
        this.isLoadingSchemas.set(false);

        const firstModule = crudTypes[0]?.module ?? '';
        this.selectedModule.set(firstModule);
        const firstSchema = crudTypes.find((schema) => schema.module === firstModule) ?? null;
        this.selectedChillType.set(firstSchema?.chillType ?? '');

        const firstEntityOptionsModule = entityOptionsTypes[0]?.module ?? '';
        this.selectedEntityOptionsModule.set(firstEntityOptionsModule);
        const firstEntityOptionsSchema = entityOptionsTypes.find((schema) => schema.module === firstEntityOptionsModule) ?? null;
        this.selectedEntityOptionsChillType.set(firstEntityOptionsSchema?.chillType ?? '');
      },
      error: (error: unknown) => {
        this.crudTypes.set([]);
        this.entityOptionsTypes.set([]);
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
    const chillType = schema.relatedChillType?.trim() || schema.chillType?.trim() || '';
    return {
      module: schema.module?.trim() || chillType.split('.')[0] || 'Default',
      chillType,
      queryChillType: schema.chillType?.trim() ?? '',
      displayName: schema.displayName?.trim() || schema.name?.trim() || chillType,
      viewCode: schema.chillViewCode?.trim() || 'default'
    };
  }

  private toEntityOptionsSchemaOption(schema: ChillSchemaListItem): EntityOptionsSchemaOption | null {
    const chillType = schema.chillType?.trim() ?? '';
    if (!chillType) {
      return null;
    }

    return {
      module: schema.module?.trim() || chillType.split('.')[0] || 'Default',
      chillType,
      displayName: schema.displayName?.trim() || schema.name?.trim() || chillType,
      kind: this.isQuerySchema(schema) ? 'Query' : 'Entity'
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

  private async buildCrudMenuConfiguration(schema: CrudSchemaOption): Promise<Record<string, unknown>> {
    const viewCode = this.normalizeViewCode(this.viewCode());
    const baseConfiguration: Record<string, unknown> = {
      chillType: schema.chillType,
      viewCode
    };
    const queryChillType = schema.queryChillType.trim();
    if (queryChillType) {
      baseConfiguration['chillQuery'] = queryChillType;
    }

    const entitySchema = await firstValueFrom(this.chill.getSchema(schema.chillType, viewCode, undefined, true));
    return applySchemaRelationsToCrudConfiguration(baseConfiguration, entitySchema as ChillSchema | null);
  }

  private async expandNodeForHover(node: WorkspaceMenuNode): Promise<void> {
    if (node.isExpanded || node.isLoadingChildren) {
      return;
    }

    if (!node.childrenLoaded) {
      await this.loadNodeChildren(node, true);
      return;
    }

    this.menuRoots.update((roots) => this.updateNodeCollection(roots, node.item.guid, (current) => ({
      ...current,
      isExpanded: true
    })));
  }

  private findNodeContext(
    targetGuid: string,
    nodes: WorkspaceMenuNode[],
    parent: WorkspaceMenuNode | null
  ): { node: WorkspaceMenuNode; parent: WorkspaceMenuNode | null; siblings: WorkspaceMenuNode[]; index: number } | null {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.item.guid === targetGuid) {
        return { node, parent, siblings: nodes, index };
      }

      const childResult = this.findNodeContext(targetGuid, node.children, node);
      if (childResult) {
        return childResult;
      }
    }

    return null;
  }

  private findChildCollection(parentGuid: string | null): WorkspaceMenuNode[] | null {
    if (!parentGuid) {
      return this.menuRoots();
    }

    return this.findNodeContext(parentGuid, this.menuRoots(), null)?.node.children ?? null;
  }

  private isDescendantOf(node: WorkspaceMenuNode, possibleDescendantGuid: string): boolean {
    for (const child of node.children) {
      if (child.item.guid === possibleDescendantGuid || this.isDescendantOf(child, possibleDescendantGuid)) {
        return true;
      }
    }

    return false;
  }

  private reindexMenuItems(nodes: WorkspaceMenuNode[], parent: ChillMenuItem | null): ChillMenuItem[] {
    return nodes.map((node, index) => ({
      ...node.item,
      parent,
      positionNo: index + 1
    }));
  }

  private toParentReference(item: ChillMenuItem): ChillMenuItem {
    return {
      guid: item.guid,
      positionNo: item.positionNo,
      title: item.title,
      description: item.description,
      parent: null,
      componentName: item.componentName,
      componentConfigurationJson: item.componentConfigurationJson,
      menuHierarchy: item.menuHierarchy
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

  private clearDragHoverExpandTimer(nodeGuid: string): void {
    const timer = this.dragHoverExpandTimers.get(nodeGuid);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.dragHoverExpandTimers.delete(nodeGuid);
    this.dragHoverExpandGuid.update((current) => current === nodeGuid ? '' : current);
  }

  private clearAllDragHoverExpandTimers(): void {
    for (const timer of this.dragHoverExpandTimers.values()) {
      clearTimeout(timer);
    }

    this.dragHoverExpandTimers.clear();
    this.dragHoverExpandGuid.set('');
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
}
