import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillEntity, ChillEntityChangeNotification, ChillMetadataRecord, ChillPropertySchema, ChillSchema } from '../models/chill-schema.models';
import { Subscription, firstValueFrom } from 'rxjs';
import { ChillService } from '../services/chill.service';
import { WorkspaceDialogService } from '../services/workspace-dialog.service';
import { WorkspaceLayoutService } from '../services/workspace-layout.service';
import { ChillI18nLabelComponent } from './chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from './chill-i18n-button-label.component';
import { ChillPolymorphicInputComponent } from './chill-polymorphic-input.component';
import { ChillPolymorphicOutputComponent } from './chill-polymorphic-output.component';

const TABLE_LAYOUT_METADATA_KEY = 'chill-table-component';

interface ColumnLayoutState {
  name: string;
  displayName: string;
  hidden: boolean;
}

interface PersistedTableLayout {
  columns: ColumnLayoutState[];
}

type TableColumn = ChillPropertySchema & {
  hidden: boolean;
  displayName: string;
};

export interface ChillTableRowAction {
  icon?: string;
  iconClass?: string;
  label?: string;
  labelGuid?: string | null;
  primaryDefaultText?: string | null;
  secondaryDefaultText?: string | null;
  ariaLabel?: string;
  disabled?: (entity: ChillEntity) => boolean;
  handler: (entity: ChillEntity) => void;
}

export interface ChillTableSelectionColumn {
  ariaLabel?: string;
  disabled?: (entity: ChillEntity) => boolean;
  isSelected: (entity: ChillEntity) => boolean;
  toggle: (entity: ChillEntity, selected: boolean) => void;
}

export interface ChillTableCellEditCommitEvent {
  entity: ChillEntity;
  propertyName: string;
  value: JsonValue;
  dirtyProperties: string[];
}

export interface ChillTableValidationFocus {
  entityKey: string;
  propertyName: string;
}

interface ActiveCellEditState {
  entityKey: string;
  propertyName: string;
  entity: ChillEntity;
  form: FormGroup<Record<string, FormControl<JsonValue>>>;
  originalValue: JsonValue | null;
  isValid: boolean;
  isLookupDialogOpen: boolean;
  isCommitting: boolean;
}

interface ActiveRowActionMenuState {
  entityKey: string;
  top: number;
  left: number;
}

@Component({
  selector: 'app-chill-table',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillI18nLabelComponent, ChillI18nButtonLabelComponent, ChillPolymorphicOutputComponent, ChillPolymorphicInputComponent],
  templateUrl: './chill-table.component.html',
  styleUrl: './chill-table.component.scss'
})
export class ChillTableComponent {
  // #region Service Injections
  readonly chill = inject(ChillService);
  readonly dialog = inject(WorkspaceDialogService, { optional: true });
  readonly layout = inject(WorkspaceLayoutService);
  // #endregion

  // #region Inputs
  readonly schema = input<ChillSchema | null>(null);
  readonly entities = input<ChillEntity[]>([]);
  readonly selectionColumn = input<ChillTableSelectionColumn | null>(null);
  readonly rowAction = input<ChillTableRowAction | null>(null);
  readonly rowActions = input<ChillTableRowAction[] | null>(null);
  readonly enableInlineEditing = input(false);
  readonly validationFocus = input<ChillTableValidationFocus | null>(null);
  readonly showSchemaHeader = input(true);
  // #endregion

  // #region Outputs
  readonly cellEditCommit = output<ChillTableCellEditCommitEvent>();
  // #endregion

  // #region State References
  readonly isEditLayoutMode = signal(false);
  readonly isSavingLayout = signal(false);
  readonly layoutError = signal('');
  readonly dragColumnName = signal('');
  readonly layoutState = signal<ColumnLayoutState[]>([]);
  readonly activeCellEdit = signal<ActiveCellEditState | null>(null);
  readonly activeRowActionMenu = signal<ActiveRowActionMenuState | null>(null);
  readonly displayedEntities = signal<ChillEntity[]>([]);
  readonly schemaRefreshTick = signal(0);
  private readonly entityNotificationSubscriptions = new Map<string, Subscription>();
  private subscribedNotificationChillType = '';
  // #endregion

  // #region Component Lifecycle

  /**
   * Wires reactive state for layout persistence, live entity updates, validation-driven focus, and inline edit completion.
   */
  constructor() {
    effect(() => {
      this.layoutState.set(this.readLayoutState(this.schema()));
      this.layoutError.set('');
      this.isEditLayoutMode.set(false);
    });

    effect(() => {
      this.displayedEntities.set(this.entities());
      this.syncEntityNotificationSubscriptions(this.schema(), this.displayedEntities());
    });

    effect(() => {
      if (!this.layout.isLayoutEditingEnabled()) {
        this.isEditLayoutMode.set(false);
      }
    });

    effect(() => {
      const validationFocus = this.validationFocus();
      if (!validationFocus || !this.enableInlineEditing()) {
        return;
      }

      const activeCellEdit = this.activeCellEdit();
      if (
        activeCellEdit
        && activeCellEdit.entityKey === validationFocus.entityKey
        && activeCellEdit.propertyName === validationFocus.propertyName
      ) {
        return;
      }

      const targetEntity = this.displayedEntities().find((entity) => this.trackByEntity(0, entity) === validationFocus.entityKey);
      const targetColumn = this.visibleColumns().find((column) => column.name === validationFocus.propertyName);
      if (!targetEntity || !targetColumn || this.isDeletedRow(targetEntity)) {
        return;
      }

      this.activateCellEdit(targetEntity, targetColumn);
    });

    effect(() => {
      const activeCellEdit = this.activeCellEdit();
      if (!activeCellEdit?.isCommitting) {
        return;
      }

      const latestEntity = this.displayedEntities().find((entity) => this.trackByEntity(0, entity) === activeCellEdit.entityKey);
      if (!latestEntity) {
        this.activeCellEdit.set(null);
        return;
      }

      if (this.rowHasValidationErrors(latestEntity)) {
        this.activeCellEdit.set({
          ...activeCellEdit,
          entity: latestEntity,
          isCommitting: false
        });
        return;
      }

      const latestValue = this.readPropertyValue(latestEntity, activeCellEdit.propertyName) ?? null;
      const editedValue = activeCellEdit.form.controls[activeCellEdit.propertyName]?.value ?? null;
      if (this.areJsonValuesEqual(latestValue, editedValue)) {
        this.activeCellEdit.set(null);
      }
    });
  }

  /**
   * Releases per-entity live update subscriptions when the table is destroyed.
   */
  ngOnDestroy(): void {
    this.clearEntityNotificationSubscriptions();
  }

  // #endregion

  // #region Computed Properties

  /**
   * Merges schema properties with persisted layout preferences and preserves the saved column order.
   */
  readonly columns = computed<TableColumn[]>(() => {
    this.schemaRefreshTick();
    const schema = this.schema();
    const properties = schema?.properties ?? [];
    const propertyMap = new Map(properties.map((property) => [property.name, property]));
    const savedLayout = this.layoutState();
    const orderedNames = [
      ...savedLayout.map((item) => item.name).filter((name) => propertyMap.has(name)),
      ...properties.map((property) => property.name).filter((name) => !savedLayout.some((item) => item.name === name))
    ];

    return orderedNames
      .map((name) => {
        const property = propertyMap.get(name);
        if (!property) {
          return null;
        }

        const layout = savedLayout.find((item) => item.name === name);
        return {
          ...property,
          displayName: layout?.displayName?.trim() || property.displayName || property.name,
          hidden: layout?.hidden ?? false
        };
      })
      .filter((column): column is TableColumn => column !== null);
  });

  /**
   * Filters the resolved column list down to visible columns.
   */
  readonly visibleColumns = computed(() => this.columns().filter((column) => !column.hidden));

  /**
   * Filters the resolved column list down to hidden columns.
   */
  readonly hiddenColumns = computed(() => this.columns().filter((column) => column.hidden));

  /**
   * Hides row selection while the user is editing layout metadata.
   */
  readonly hasSelectionColumn = computed(() => !!this.selectionColumn() && !this.isEditLayoutMode());

  /**
   * Normalizes the single-action and multi-action inputs into one action list.
   */
  readonly resolvedRowActions = computed(() => {
    const rowActions = this.rowActions();
    if (rowActions && rowActions.length > 0) {
      return rowActions;
    }

    const rowAction = this.rowAction();
    return rowAction ? [rowAction] : [];
  });

  /**
   * Hides row actions while the user is editing layout metadata.
   */
  readonly hasActionColumn = computed(() => this.resolvedRowActions().length > 0 && !this.isEditLayoutMode());

  // #endregion

  // #region Public Methods

  /**
   * Builds a stable row key, preferring Guid-like identifiers before falling back to labels or index.
   */
  trackByEntity(index: number, entity: ChillEntity): string {
    return this.readEntityText(entity, 'guid')
      ?? this.readEntityText(entity, 'Guid')
      ?? this.readEntityText(entity, 'label')
      ?? this.readEntityText(entity, 'Label')
      ?? `${index}`;
  }

  /**
   * Enters layout-edit mode immediately, or persists the current layout when toggled off.
   */
  toggleEditLayoutMode(): void {
    if (!this.layout.isLayoutEditingEnabled()) {
      return;
    }

    if (!this.isEditLayoutMode()) {
      this.isEditLayoutMode.set(true);
      this.layoutError.set('');
      return;
    }

    this.saveLayout();
  }

  /**
   * Applies an in-memory display-name override for the selected column.
   */
  updateColumnDisplayName(columnName: string, value: string): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, displayName: value }
      : item));
  }

  /**
   * Marks a column as visible or hidden inside the pending layout state.
   */
  updateColumnHidden(columnName: string, hidden: boolean): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, hidden }
      : item));
  }

  openPropertySettings(property: ChillPropertySchema): void {
    const schema = this.schema();
    if (!schema || !this.dialog) {
      return;
    }

    void (async () => {
      const { SchemaPropertyDialogComponent } = await import('./schema-property-dialog.component');
      const result = await this.dialog!.openDialog<ChillPropertySchema>({
        title: property.displayName?.trim() || property.name,
        component: SchemaPropertyDialogComponent,
        okLabel: this.chill.T('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Save', 'Salva'),
        inputs: {
          schema,
          property
        }
      });

      if (result.status !== 'confirmed' || !result.value) {
        return;
      }

      this.savePropertySchema(schema, property.name, result.value);
    })();
  }

  /**
   * Moves a hidden column back into the visible portion of the saved layout ordering.
   */
  revealColumn(columnName: string): void {
    const normalizedColumnName = columnName.trim();
    if (!normalizedColumnName) {
      return;
    }

    this.layoutState.update((current) => {
      const targetIndex = current.findIndex((item) => item.name === normalizedColumnName);
      if (targetIndex < 0) {
        return current;
      }

      const next = [...current];
      const [target] = next.splice(targetIndex, 1);
      const insertIndex = next.findIndex((item) => item.hidden);
      next.splice(insertIndex >= 0 ? insertIndex : next.length, 0, { ...target, hidden: false });
      return next;
    });
  }

  /**
   * Records which column is being dragged during layout editing.
   */
  beginDrag(columnName: string): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    this.dragColumnName.set(columnName);
  }

  /**
   * Enables the column drop target only while layout editing is active.
   */
  allowDrop(event: DragEvent): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    event.preventDefault();
  }

  /**
   * Reorders the pending layout by moving the dragged column onto the target position.
   */
  dropColumn(targetColumnName: string): void {
    const sourceColumnName = this.dragColumnName();
    if (!sourceColumnName || sourceColumnName === targetColumnName) {
      this.dragColumnName.set('');
      return;
    }

    this.layoutState.update((current) => {
      const next = [...current];
      const sourceIndex = next.findIndex((item) => item.name === sourceColumnName);
      const targetIndex = next.findIndex((item) => item.name === targetColumnName);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }

      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });

    this.dragColumnName.set('');
  }

  /**
   * Clears the active drag marker after drag completes or is cancelled.
   */
  endDrag(): void {
    this.dragColumnName.set('');
  }

  /**
   * Invokes the configured row action with the current entity.
   */
  runRowAction(action: ChillTableRowAction, entity: ChillEntity, menu?: HTMLDetailsElement): void {
    void menu;
    this.closeRowActionMenu();
    action.handler(entity);
  }

  /**
   * Toggles the floating row-action menu anchored to the trigger button.
   */
  toggleRowActionMenu(event: MouseEvent, entity: ChillEntity): void {
    event.preventDefault();
    event.stopPropagation();

    const trigger = event.currentTarget;
    if (!(trigger instanceof HTMLElement)) {
      return;
    }

    const entityKey = this.trackByEntity(0, entity);
    const currentMenu = this.activeRowActionMenu();
    if (currentMenu?.entityKey === entityKey) {
      this.closeRowActionMenu();
      return;
    }

    this.activeRowActionMenu.set(this.buildRowActionMenuState(entityKey, trigger));
  }

  /**
   * Returns true when the floating row-action menu belongs to the provided entity.
   */
  isRowActionMenuOpen(entity: ChillEntity): boolean {
    return this.activeRowActionMenu()?.entityKey === this.trackByEntity(0, entity);
  }

  /**
   * Closes the floating row-action menu.
   */
  closeRowActionMenu(): void {
    this.activeRowActionMenu.set(null);
  }

  /**
   * Exposes the computed fixed-position style for the active row-action menu.
   */
  rowActionMenuStyle(): Record<string, string> | null {
    const menu = this.activeRowActionMenu();
    if (!menu) {
      return null;
    }

    return {
      top: `${menu.top}px`,
      left: `${menu.left}px`
    };
  }

  /**
   * Maps a few common semantic action names to icons and otherwise returns the provided icon verbatim.
   */
  rowActionIcon(action: ChillTableRowAction): string {
    const icon = action.icon?.trim();
    if (!icon) {
      return 'edit';
    }

    if (action.iconClass === 'material-symbol-icon') {
      return icon;
    }

    switch (icon.toLowerCase()) {
      case 'pencil':
      case 'edit':
        return 'edit';
      case 'bin':
      case 'delete':
      case 'trash':
        return 'delete';
      default:
        return icon;
    }
  }

  /**
   * Applies Material Symbols automatically for common semantic row actions.
   */
  rowActionIconClass(action: ChillTableRowAction): string {
    if (action.iconClass === 'material-symbol-icon') {
      return 'material-symbol-icon';
    }

    const icon = action.icon?.trim().toLowerCase();
    if (!icon || icon === 'pencil' || icon === 'edit' || icon === 'bin' || icon === 'delete' || icon === 'trash') {
      return 'material-symbol-icon';
    }

    return action.iconClass?.trim() ?? '';
  }

  /**
   * Derives a readable row-action label when the host does not provide one.
   */
  rowActionLabel(action: ChillTableRowAction): string {
    if (action.labelGuid?.trim() && action.primaryDefaultText?.trim() && action.secondaryDefaultText?.trim()) {
      return this.chill.T(
        action.labelGuid.trim(),
        action.primaryDefaultText.trim(),
        action.secondaryDefaultText.trim()
      );
    }

    if (action.label?.trim()) {
      return action.label.trim();
    }

    if (action.ariaLabel?.trim()) {
      return action.ariaLabel.trim();
    }

    switch (this.rowActionIcon(action).trim().toLowerCase()) {
      case 'edit':
        return this.chill.T('E64B6037-B83A-406A-B5D6-CB5AA6E42FC6', 'Edit row', 'Modifica riga');
      case 'delete':
        return this.chill.T('04290FEE-910B-4A1B-B83D-A3AC0427BAAB', 'Delete row', 'Elimina riga');
      default:
        return this.chill.T('6455D4FC-D267-4AA1-83C9-749D511838CB', 'Row action', 'Azione riga');
    }
  }

  /**
   * Forwards row selection changes to the hosting selection controller.
   */
  toggleRowSelection(entity: ChillEntity, selected: boolean): void {
    this.selectionColumn()?.toggle(entity, selected);
  }

  /**
   * Reads the current selection state from the hosting selection controller.
   */
  isRowSelected(entity: ChillEntity): boolean {
    return this.selectionColumn()?.isSelected(entity) ?? false;
  }

  /**
   * Delegates row-selection disabled state to the host when provided.
   */
  isRowSelectionDisabled(entity: ChillEntity): boolean {
    return this.selectionColumn()?.disabled?.(entity) ?? false;
  }

  /**
   * Evaluates whether a row action should be disabled for the current entity.
   */
  isRowActionDisabled(action: ChillTableRowAction, entity: ChillEntity): boolean {
    return action.disabled?.(entity) ?? false;
  }

  @HostListener('document:click')
  handleDocumentClick(): void {
    this.closeRowActionMenu();
  }

  @HostListener('window:resize')
  handleWindowResize(): void {
    this.closeRowActionMenu();
  }

  @HostListener('window:scroll')
  handleWindowScroll(): void {
    this.closeRowActionMenu();
  }

  /**
   * Treats non-pristine CRUD states as pending so the row can render transient styling.
   */
  isPendingRow(entity: ChillEntity): boolean {
    const state = this.readCrudState(entity);
    return state === 'draft' || state === 'dirty' || state === 'saving' || state === 'error' || state === 'deleted';
  }

  /**
   * Uses the normalized CRUD status to identify deleted rows.
   */
  isDeletedRow(entity: ChillEntity): boolean {
    return this.readCrudState(entity) === 'deleted';
  }

  /**
   * Creates a single-property edit session for the chosen cell using a fresh schema-driven form.
   */
  activateCellEdit(entity: ChillEntity, column: TableColumn): void {
    if (!this.enableInlineEditing() || this.isEditLayoutMode() || this.isDeletedRow(entity)) {
      return;
    }

    const schema = this.schema();
    if (!schema) {
      return;
    }

    const propertyName = column.name;
    this.activeCellEdit.set({
      entityKey: this.trackByEntity(0, entity),
      propertyName,
      entity,
      form: this.chill.prepareForm(schema, entity),
      originalValue: this.readPropertyValue(entity, propertyName) ?? null,
      isValid: true,
      isLookupDialogOpen: false,
      isCommitting: false
    });
  }

  /**
   * Matches the requested cell against the current inline edit session.
   */
  isCellEditing(entity: ChillEntity, column: TableColumn): boolean {
    const activeCellEdit = this.activeCellEdit();
    return !!activeCellEdit
      && activeCellEdit.entityKey === this.trackByEntity(0, entity)
      && activeCellEdit.propertyName === column.name;
  }

  /**
   * Clears the committing flag when the active editor changes its tracked property value.
   */
  handleCellValueChange(value: Record<string, JsonValue>): void {
    const activeCellEdit = this.activeCellEdit();
    if (!activeCellEdit) {
      return;
    }

    if (!(activeCellEdit.propertyName in value)) {
      return;
    }

    this.activeCellEdit.set({
      ...activeCellEdit,
      isCommitting: false
    });
  }

  /**
   * Keeps the active edit session aligned with the child editor validity state.
   */
  handleCellValidityChange(isValid: boolean): void {
    const activeCellEdit = this.activeCellEdit();
    if (!activeCellEdit) {
      return;
    }

    this.activeCellEdit.set({
      ...activeCellEdit,
      isValid,
      isCommitting: false
    });
  }

  /**
   * Keeps inline editing alive while a lookup picker dialog owns the focus outside the table cell.
   */
  handleLookupDialogOpenChange(isOpen: boolean): void {
    const activeCellEdit = this.activeCellEdit();
    if (!activeCellEdit) {
      return;
    }

    this.activeCellEdit.set({
      ...activeCellEdit,
      isLookupDialogOpen: isOpen
    });

    if (isOpen) {
      return;
    }

    const activeControl = activeCellEdit.form.controls[activeCellEdit.propertyName];
    if (activeControl?.dirty) {
      this.commitCellEdit();
    }
  }

  /**
   * Commits the edit only when focus leaves the entire editor, not when it moves within the editor.
   */
  handleCellFocusOut(event: FocusEvent): void {
    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) {
      return;
    }

    if (this.activeCellEdit()?.isLookupDialogOpen) {
      return;
    }

    this.commitCellEdit();
  }

  /**
   * Supports Enter-to-commit and Escape-to-cancel without letting the event leak to the row.
   */
  handleCellEditorKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.commitCellEdit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelCellEdit();
    }
  }

  /**
   * Drops the current inline edit session without emitting a commit.
   */
  cancelCellEdit(): void {
    this.activeCellEdit.set(null);
  }

  /**
   * Emits a cell commit only for valid edits whose value actually changed from the original snapshot.
   */
  commitCellEdit(): void {
    const activeCellEdit = this.activeCellEdit();
    if (!activeCellEdit) {
      return;
    }

    const value = activeCellEdit.form.controls[activeCellEdit.propertyName]?.value ?? null;
    if (!activeCellEdit.isValid || this.areJsonValuesEqual(activeCellEdit.originalValue, value)) {
      this.activeCellEdit.set(null);
      return;
    }

    this.activeCellEdit.set({
      ...activeCellEdit,
      isCommitting: true
    });
    this.cellEditCommit.emit({
      entity: activeCellEdit.entity,
      propertyName: activeCellEdit.propertyName,
      value,
      dirtyProperties: this.readDirtyControlNames(activeCellEdit.form)
    });
  }

  /**
   * Extracts per-field validation errors from the row chill state in a template-friendly shape.
   */
  rowFieldErrors(entity: ChillEntity): Record<string, string> {
    const crudState = this.readChillState(entity);
    if (!crudState || typeof crudState !== 'object' || Array.isArray(crudState)) {
      return {};
    }

    const validationErrors = (crudState as JsonObject)['validationErrors'];
    if (!validationErrors || typeof validationErrors !== 'object' || Array.isArray(validationErrors)) {
      return {};
    }

    const nextErrors: Record<string, string> = {};
    for (const [fieldName, value] of Object.entries(validationErrors as Record<string, JsonValue>)) {
      if (typeof value === 'string' && value.trim().length > 0) {
        nextErrors[fieldName] = value;
      }
    }

    return nextErrors;
  }

  /**
   * Detects either field-level or generic validation errors stored in the row chill state.
   */
  rowHasValidationErrors(entity: ChillEntity): boolean {
    if (Object.keys(this.rowFieldErrors(entity)).length > 0) {
      return true;
    }

    const crudState = this.readChillState(entity);
    if (!crudState || typeof crudState !== 'object' || Array.isArray(crudState)) {
      return false;
    }

    const genericErrors = (crudState as JsonObject)['genericErrors'];
    return Array.isArray(genericErrors)
      && genericErrors.some((message) => typeof message === 'string' && message.trim().length > 0);
  }

  // #endregion

  // #region Helper Methods

  /**
   * Keeps live entity subscriptions aligned with the current schema type and visible entity set.
   */
  private syncEntityNotificationSubscriptions(schema: ChillSchema | null, entities: ChillEntity[]): void {
    const chillType = schema?.chillType?.trim() ?? '';
    if (!chillType) {
      this.clearEntityNotificationSubscriptions();
      return;
    }

    if (this.subscribedNotificationChillType && this.subscribedNotificationChillType !== chillType) {
      this.clearEntityNotificationSubscriptions();
    }
    this.subscribedNotificationChillType = chillType;

    const targetGuids = new Set(
      entities
        .map((entity) => this.readEntityGuid(entity))
        .filter((guid) => guid.length > 0)
    );

    for (const [guid, subscription] of this.entityNotificationSubscriptions.entries()) {
      if (targetGuids.has(guid)) {
        continue;
      }

      subscription.unsubscribe();
      this.entityNotificationSubscriptions.delete(guid);
    }

    for (const guid of targetGuids) {
      if (this.entityNotificationSubscriptions.has(guid)) {
        continue;
      }

      const subscription = this.chill.watchEntityChanges(chillType, guid).subscribe({
        next: (changes) => {
          void this.handleEntityNotifications(chillType, changes);
        },
        error: () => {
          const currentSubscription = this.entityNotificationSubscriptions.get(guid);
          currentSubscription?.unsubscribe();
          this.entityNotificationSubscriptions.delete(guid);
        }
      });
      this.entityNotificationSubscriptions.set(guid, subscription);
    }
  }

  /**
   * Unsubscribes from all live entity notifications and clears the associated bookkeeping.
   */
  private clearEntityNotificationSubscriptions(): void {
    for (const subscription of this.entityNotificationSubscriptions.values()) {
      subscription.unsubscribe();
    }

    this.entityNotificationSubscriptions.clear();
    this.subscribedNotificationChillType = '';
  }

  /**
   * Refreshes locally displayed rows only for remote update notifications that contain a Guid.
   */
  private async handleEntityNotifications(chillType: string, changes: ChillEntityChangeNotification[]): Promise<void> {
    for (const change of changes) {
      if (change.action !== 'UPDATED') {
        continue;
      }

      const guid = change.guid?.trim();
      if (!guid) {
        continue;
      }

      await this.refreshDisplayedEntity(chillType, guid);
    }
  }

  /**
   * Reloads a row from the server, merges remote changes into non-dirty fields, and warns on conflicts.
   */
  private async refreshDisplayedEntity(chillType: string, guid: string): Promise<void> {
    const schema = this.schema();
    if (!schema) {
      return;
    }

    const currentEntity = this.displayedEntities().find((entity) => this.sameEntityGuid(entity, guid));
    if (!currentEntity || this.isNewEntity(currentEntity) || this.isDeletedRow(currentEntity)) {
      return;
    }

    if (this.shouldIgnoreEntityNotification(currentEntity)) {
      return;
    }

    try {
      const latestEntityResponse = await firstValueFrom(this.chill.find({
        chillType,
        guid
      }));
      if (!latestEntityResponse) {
        return;
      }

      const latestEntity = this.normalizeServerEntity(this.prepareEntityForSchema(latestEntityResponse as ChillEntity, schema));
      const currentState = this.readCrudStateObject(currentEntity);
      if (currentState.status === 'pristine') {
        this.replaceDisplayedEntity(latestEntity, currentEntity);
        return;
      }

      const dirtyProperties = new Set(currentState.dirtyProperties ?? []);
      const nextProperties: Record<string, JsonValue> = {
        ...(currentEntity.properties ?? {})
      };
      const conflictingProperties: string[] = [];

      for (const property of schema.properties ?? []) {
        const propertyName = property.name;
        const remoteValue = latestEntity.properties?.[propertyName];
        const localValue = currentEntity.properties?.[propertyName];
        if (dirtyProperties.has(propertyName)) {
          if (!this.areJsonValuesEqual(remoteValue, localValue)) {
            conflictingProperties.push(propertyName);
          }
          continue;
        }

        nextProperties[propertyName] = remoteValue ?? null;
      }

      const mergedEntity = this.withCrudState({
        ...currentEntity,
        ...latestEntity,
        properties: nextProperties
      }, {
        ...currentState
      });
      this.replaceDisplayedEntity(mergedEntity, currentEntity);

      if (conflictingProperties.length > 0) {
        await this.dialog?.confirmOk(
          this.chill.T('43B7D65E-61B6-4D20-9BEE-EA9E8467AA12', 'Entity updated remotely', 'Entita aggiornata da remoto'),
          this.chill.T(
            '490D8729-8B0B-4D25-9661-F763FEC35C42',
            `Remote updates also changed dirty properties: ${conflictingProperties.join(', ')}`,
            `L'aggiornamento remoto ha modificato anche proprieta dirty: ${conflictingProperties.join(', ')}`
          )
        );
      }
    } catch {
      return;
    }
  }

  /**
   * Persists the current column layout into schema metadata and updates local state with the saved result.
   */
  private saveLayout(): void {
    const schema = this.schema();
    if (!schema) {
      this.isEditLayoutMode.set(false);
      return;
    }

    const normalizedLayoutState = this.normalizeLayoutForSave(this.layoutState());
    const metadata = this.readSchemaMetadata(schema);
    metadata[TABLE_LAYOUT_METADATA_KEY] = JSON.stringify({
      columns: normalizedLayoutState
    } satisfies PersistedTableLayout);

    const updatedSchema: ChillSchema = {
      ...schema,
      metadata
    };

    this.isSavingLayout.set(true);
    this.layoutError.set('');

    this.chill.setSchema(updatedSchema).subscribe({
      next: (savedSchema) => {
        const effectiveSchema = savedSchema ?? updatedSchema;
        const targetSchema = this.schema();
        if (targetSchema) {
          targetSchema.metadata = this.readSchemaMetadata(effectiveSchema);
          (targetSchema as unknown as JsonObject)['metadata'] = targetSchema.metadata as unknown as JsonValue;
        }
        this.layoutState.set(normalizedLayoutState);
        this.layoutState.set(this.readLayoutState(effectiveSchema));
        this.isSavingLayout.set(false);
        this.isEditLayoutMode.set(false);
      },
      error: (error: unknown) => {
        this.layoutError.set(this.chill.formatError(error));
        this.isSavingLayout.set(false);
      }
    });
  }

  /**
   * Reads persisted column layout from schema metadata and falls back to schema order when unavailable.
   */
  private readLayoutState(schema: ChillSchema | null): ColumnLayoutState[] {
    const properties = schema?.properties ?? [];
    const defaultLayout = properties.map((property) => ({
      name: property.name,
      displayName: property.displayName || property.name,
      hidden: false
    }));

    const metadata = this.readSchemaMetadata(schema);
    const rawLayoutValue = metadata[TABLE_LAYOUT_METADATA_KEY];
    const rawLayout = typeof rawLayoutValue === 'string' ? rawLayoutValue.trim() : '';
    if (!rawLayout) {
      return defaultLayout;
    }

    try {
      const parsedLayout = JSON.parse(rawLayout) as Partial<PersistedTableLayout>;
      const savedColumns = Array.isArray(parsedLayout.columns)
        ? parsedLayout.columns
            .filter((item): item is ColumnLayoutState => typeof item?.name === 'string')
            .map((item) => ({
              name: item.name.trim(),
              displayName: typeof item.displayName === 'string' ? item.displayName : '',
              hidden: item.hidden === true
            }))
            .filter((item) => item.name.length > 0)
        : [];

      return defaultLayout.map((column) => savedColumns.find((item) => item.name === column.name) ?? column)
        .sort((left, right) => {
          const leftIndex = savedColumns.findIndex((item) => item.name === left.name);
          const rightIndex = savedColumns.findIndex((item) => item.name === right.name);
          const resolvedLeftIndex = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER;
          const resolvedRightIndex = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER;
          return resolvedLeftIndex - resolvedRightIndex;
        });
    } catch {
      return defaultLayout;
    }
  }

  /**
   * Stores visible columns before hidden ones so the persisted layout can be rendered directly.
   */
  private normalizeLayoutForSave(layoutState: ColumnLayoutState[]): ColumnLayoutState[] {
    const visibleColumns = layoutState.filter((column) => !column.hidden);
    const hiddenColumns = layoutState.filter((column) => column.hidden);
    return [...visibleColumns, ...hiddenColumns];
  }

  /**
   * Normalizes schema metadata from camelCase or legacy payload shapes into a mutable string map.
   */
  private readSchemaMetadata(schema: ChillSchema | null): ChillMetadataRecord {
    if (!schema) {
      return {};
    }

    const camelMetadata = schema.metadata;
    if (camelMetadata) {
      return { ...camelMetadata };
    }

    const pascalMetadata = (schema as unknown as JsonObject)['metadata'];
    if (pascalMetadata && typeof pascalMetadata === 'object' && !Array.isArray(pascalMetadata)) {
      return Object.fromEntries(
        Object.entries(pascalMetadata).map(([key, value]) => [key, typeof value === 'string' ? value : String(value ?? '')])
      );
    }

    return {};
  }

  /**
   * Reads a property from the entity bag first, then from direct camelCase or PascalCase fields.
   */
  private readPropertyValue(entity: ChillEntity, propertyName: string): JsonValue | undefined {
    const properties = entity.properties
      ?? (this.isJsonObjectRecord(entity['Properties']) ? entity['Properties'] : undefined);
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    return entity[propertyName] ?? entity[this.toPascalCase(propertyName)];
  }

  /**
   * Converts primitive entity properties into trimmed text for keys such as Guid or Label.
   */
  private readEntityText(entity: ChillEntity, key: string): string | null {
    const value = entity[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    return null;
  }

  /**
   * Returns the normalized lowercase CRUD status used by row rendering logic.
   */
  private readCrudState(entity: ChillEntity): string {
    const status = this.readCrudStateObject(entity).status;
    return typeof status === 'string'
      ? status.trim().toLowerCase()
      : '';
  }

  /**
   * Type guard for JSON object records.
   */
  private isJsonObjectRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Returns the raw chill state payload attached to the entity.
   */
  private readChillState(entity: ChillEntity): JsonValue | undefined {
    return entity['chillState'];
  }

  /**
   * Normalizes chill state into a predictable CRUD model with defaults for new and deleting rows.
   */
  private readCrudStateObject(entity: ChillEntity): JsonObject & {
    status?: string;
    isNew?: boolean;
    dirtyProperties?: string[] | null;
    validationErrors?: Record<string, string> | null;
    genericErrors?: string[] | null;
    errorMessage?: string | null;
  } {
    const currentState = this.readChillState(entity);
    const isNew = this.readChillStateBoolean(entity, 'isNew');
    const isDeleting = this.readChillStateBoolean(entity, 'isDeleting');
    if (currentState && typeof currentState === 'object' && !Array.isArray(currentState)) {
      const typedState = currentState as JsonObject;
      const resolvedIsNew = typedState['isNew'] === true || isNew;
      const status = typeof typedState['status'] === 'string'
        ? typedState['status']
        : (resolvedIsNew ? 'draft' : isDeleting ? 'deleted' : 'pristine');
      return {
        ...typedState,
        isNew: resolvedIsNew,
        status,
        dirtyProperties: Array.isArray(typedState['dirtyProperties'])
          ? typedState['dirtyProperties'].filter((propertyName: unknown): propertyName is string => typeof propertyName === 'string' && propertyName.trim().length > 0)
          : null
      };
    }

    return {
      isNew,
      status: isNew ? 'draft' : isDeleting ? 'deleted' : 'pristine',
      dirtyProperties: isNew ? [] : null
    };
  }

  /**
   * Merges a CRUD-state patch onto the entity while keeping derived `isNew` and `isDeleting` flags consistent.
   */
  private withCrudState(
    entity: ChillEntity,
    state: Record<string, JsonValue | undefined>
  ): ChillEntity {
    const nextState = this.sanitizeCrudState({
      ...this.readCrudStateObject(entity),
      ...state
    });

    return {
      ...entity,
      chillState: {
        ...(this.readChillState(entity) && typeof this.readChillState(entity) === 'object' && !Array.isArray(this.readChillState(entity))
          ? this.readChillState(entity) as JsonObject
          : {}),
        ...nextState,
        isNew: nextState['isNew'] === true,
        isDeleting: nextState['status'] === 'deleted'
      }
    };
  }

  /**
   * Removes undefined entries before persisting CRUD state back onto the entity payload.
   */
  private sanitizeCrudState(state: Record<string, JsonValue | undefined>): JsonObject {
    return Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined)
    ) as JsonObject;
  }

  /**
   * Resets a freshly loaded server entity back to a pristine local CRUD state.
   */
  private normalizeServerEntity(entity: ChillEntity): ChillEntity {
    return this.withCrudState(entity, {
      isNew: false,
      status: 'pristine',
      dirtyProperties: null,
      validationErrors: null,
      genericErrors: null,
      errorMessage: null,
      ignoreNotificationsUntil: null
    });
  }

  private savePropertySchema(schema: ChillSchema, originalPropertyName: string, property: ChillPropertySchema): void {
    const updatedSchema: ChillSchema = {
      ...schema,
      properties: (schema.properties ?? []).map((candidate) => candidate.name === originalPropertyName
        ? property
        : candidate)
    };

    this.isSavingLayout.set(true);
    this.layoutError.set('');

    this.chill.setSchema(updatedSchema).subscribe({
      next: (savedSchema) => {
        const effectiveSchema = savedSchema ?? updatedSchema;
        const targetSchema = this.schema();
        if (targetSchema) {
          targetSchema.metadata = this.readSchemaMetadata(effectiveSchema);
          targetSchema.properties = [...(effectiveSchema.properties ?? [])];
          (targetSchema as unknown as JsonObject)['metadata'] = targetSchema.metadata as unknown as JsonValue;
          (targetSchema as unknown as JsonObject)['properties'] = targetSchema.properties as unknown as JsonValue;
        }
        this.activeCellEdit.set(null);
        this.layoutState.set(this.readLayoutState(effectiveSchema));
        this.schemaRefreshTick.update((current) => current + 1);
        this.isSavingLayout.set(false);
      },
      error: (error: unknown) => {
        this.layoutError.set(this.chill.formatError(error));
        this.isSavingLayout.set(false);
      }
    });
  }

  /**
   * Skips live refreshes for a short window after a local save so the row keeps the just-returned server copy.
   */
  private shouldIgnoreEntityNotification(entity: ChillEntity): boolean {
    const ignoreUntil = this.readCrudStateObject(entity)['ignoreNotificationsUntil'];
    return typeof ignoreUntil === 'number' && Number.isFinite(ignoreUntil) && ignoreUntil > Date.now();
  }

  /**
   * Ensures a server entity exposes every schema property through the `properties` bag expected by the table.
   */
  private prepareEntityForSchema(entity: ChillEntity, schema: ChillSchema): ChillEntity {
    const nextProperties: Record<string, JsonValue> = {
      ...(entity.properties ?? {})
    };

    for (const property of schema.properties ?? []) {
      if (property.name in nextProperties) {
        continue;
      }

      nextProperties[property.name] = this.readPropertyValue(entity, property.name) ?? null;
    }

    return {
      ...entity,
      chillType: this.readStringValue(entity['chillType']) || schema.chillType?.trim() || '',
      properties: nextProperties
    };
  }

  /**
   * Replaces a row in the displayed collection and pushes fresh values into any active editor for that row.
   */
  private replaceDisplayedEntity(nextEntity: ChillEntity, previousEntity: ChillEntity): void {
    const previousEntityKey = this.trackByEntity(0, previousEntity);
    this.displayedEntities.update((current) => current.map((entity) => this.trackByEntity(0, entity) === previousEntityKey ? nextEntity : entity));

    const activeCellEdit = this.activeCellEdit();
    if (!activeCellEdit || activeCellEdit.entityKey !== previousEntityKey) {
      return;
    }

    for (const [propertyName, control] of Object.entries(activeCellEdit.form.controls)) {
      const nextValue = this.readPropertyValue(nextEntity, propertyName) ?? null;
      if (this.areJsonValuesEqual(control.value, nextValue)) {
        continue;
      }

      control.setValue(nextValue);
    }

    this.activeCellEdit.set({
      ...activeCellEdit,
      entity: nextEntity
    });
  }

  /**
   * Uses normalized CRUD state to detect client-side draft rows.
   */
  private isNewEntity(entity: ChillEntity): boolean {
    return this.readCrudStateObject(entity).isNew === true;
  }

  /**
   * Collects the property names whose form controls are currently dirty.
   */
  private readDirtyControlNames(form: FormGroup<Record<string, FormControl<JsonValue>>>): string[] {
    return Object.entries(form.controls)
      .filter(([, control]) => control.dirty)
      .map(([propertyName]) => propertyName.trim())
      .filter((propertyName) => propertyName.length > 0);
  }

  /**
   * Reads the row Guid using either camelCase or PascalCase server field names.
   */
  private readEntityGuid(entity: ChillEntity): string {
    return this.readEntityText(entity, 'guid')
      ?? this.readEntityText(entity, 'Guid')
      ?? '';
  }

  /**
   * Normalizes a JSON value into trimmed text when it is already a string.
   */
  private readStringValue(value: JsonValue | undefined): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  /**
   * Reads a boolean flag from the raw chill state object.
   */
  private readChillStateBoolean(entity: ChillEntity, propertyName: string): boolean {
    const chillState = this.readChillState(entity);
    if (!chillState || typeof chillState !== 'object' || Array.isArray(chillState)) {
      return false;
    }

    return (chillState as JsonObject)[propertyName] === true;
  }

  /**
   * Compares an entity Guid with an incoming Guid after trimming the incoming value.
   */
  private sameEntityGuid(entity: ChillEntity, guid: string): boolean {
    return this.readEntityGuid(entity) === guid.trim();
  }

  /**
   * Converts a property name to PascalCase for payloads that expose both casing styles.
   */
  private toPascalCase(value: string): string {
    return value.length > 0
      ? `${value[0].toUpperCase()}${value.slice(1)}`
      : value;
  }

  /**
   * Uses JSON serialization as a pragmatic deep-equality check for editor values and server payloads.
   */
  private areJsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  /**
   * Computes a viewport-clamped fixed position for the row-action menu.
   */
  private buildRowActionMenuState(entityKey: string, trigger: HTMLElement): ActiveRowActionMenuState {
    const rect = trigger.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 112;
    const viewportPadding = 8;
    const preferredLeft = rect.right - menuWidth;
    const maxLeft = window.innerWidth - menuWidth - viewportPadding;
    const left = Math.max(viewportPadding, Math.min(preferredLeft, maxLeft));
    const fitsBelow = rect.bottom + 6 + menuHeight <= window.innerHeight - viewportPadding;
    const top = fitsBelow
      ? rect.bottom + 6
      : Math.max(viewportPadding, rect.top - menuHeight - 6);

    return { entityKey, top, left };
  }

  // #endregion
}
