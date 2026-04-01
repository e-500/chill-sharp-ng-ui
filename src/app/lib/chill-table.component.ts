import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillEntity, ChillEntityChangeNotification, ChillPropertySchema, ChillSchema } from '../models/chill-schema.models';
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
  isCommitting: boolean;
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
  readonly displayedEntities = signal<ChillEntity[]>([]);
  private readonly entityNotificationSubscriptions = new Map<string, Subscription>();
  private subscribedNotificationChillType = '';
  // #endregion

  // #region Component Lifecycle

  /**
   * Constructor that sets up effects for layout state, displayed entities, layout editing, validation focus, and active cell edit.
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
   * Lifecycle hook that clears entity notification subscriptions on destroy.
   */
  ngOnDestroy(): void {
    this.clearEntityNotificationSubscriptions();
  }

  // #endregion

  // #region Computed Properties

  /**
   * Computed property that returns the table columns based on the schema and layout state.
   */
  readonly columns = computed<TableColumn[]>(() => {
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
   * Computed property that returns only the visible columns.
   */
  readonly visibleColumns = computed(() => this.columns().filter((column) => !column.hidden));

  /**
   * Computed property that returns the hidden columns.
   */
  readonly hiddenColumns = computed(() => this.columns().filter((column) => column.hidden));

  /**
   * Computed property that checks if there is a selection column and not in edit layout mode.
   */
  readonly hasSelectionColumn = computed(() => !!this.selectionColumn() && !this.isEditLayoutMode());

  /**
   * Computed property that resolves the row actions from inputs.
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
   * Computed property that checks if there are row actions and not in edit layout mode.
   */
  readonly hasActionColumn = computed(() => this.resolvedRowActions().length > 0 && !this.isEditLayoutMode());

  // #endregion

  // #region Public Methods

  /**
   * Generates a unique key for tracking entities based on guid, Guid, label, or index.
   */
  trackByEntity(index: number, entity: ChillEntity): string {
    return this.readEntityText(entity, 'guid')
      ?? this.readEntityText(entity, 'Guid')
      ?? this.readEntityText(entity, 'label')
      ?? this.readEntityText(entity, 'Label')
      ?? `${index}`;
  }

  /**
   * Toggles the edit layout mode, saving the layout if exiting edit mode.
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
   * Updates the display name of a column in the layout state.
   */
  updateColumnDisplayName(columnName: string, value: string): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, displayName: value }
      : item));
  }

  /**
   * Updates the hidden state of a column in the layout state.
   */
  updateColumnHidden(columnName: string, hidden: boolean): void {
    this.layoutState.update((current) => current.map((item) => item.name === columnName
      ? { ...item, hidden }
      : item));
  }

  /**
   * Reveals a hidden column by moving it to the visible section.
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
   * Begins dragging a column if in edit layout mode.
   */
  beginDrag(columnName: string): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    this.dragColumnName.set(columnName);
  }

  /**
   * Allows dropping during drag if in edit layout mode.
   */
  allowDrop(event: DragEvent): void {
    if (!this.isEditLayoutMode()) {
      return;
    }

    event.preventDefault();
  }

  /**
   * Drops a column at the target position during drag.
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
   * Ends the drag operation.
   */
  endDrag(): void {
    this.dragColumnName.set('');
  }

  /**
   * Runs a row action handler for the given entity.
   */
  runRowAction(action: ChillTableRowAction, entity: ChillEntity): void {
    action.handler(entity);
  }

  /**
   * Returns the icon for a row action, defaulting to a pencil if not specified.
   */
  rowActionIcon(action: ChillTableRowAction): string {
    const icon = action.icon?.trim();
    if (!icon) {
      return '✎';
    }

    switch (icon.toLowerCase()) {
      case 'pencil':
      case 'edit':
        return '✎';
      case 'bin':
      case 'delete':
      case 'trash':
        return '🗑';
      default:
        return icon;
    }
  }

  /**
   * Toggles the selection state of a row.
   */
  toggleRowSelection(entity: ChillEntity, selected: boolean): void {
    this.selectionColumn()?.toggle(entity, selected);
  }

  /**
   * Checks if a row is selected.
   */
  isRowSelected(entity: ChillEntity): boolean {
    return this.selectionColumn()?.isSelected(entity) ?? false;
  }

  /**
   * Checks if row selection is disabled for an entity.
   */
  isRowSelectionDisabled(entity: ChillEntity): boolean {
    return this.selectionColumn()?.disabled?.(entity) ?? false;
  }

  /**
   * Checks if a row action is disabled for an entity.
   */
  isRowActionDisabled(action: ChillTableRowAction, entity: ChillEntity): boolean {
    return action.disabled?.(entity) ?? false;
  }

  /**
   * Checks if a row is in a pending state (draft, dirty, saving, error, deleted).
   */
  isPendingRow(entity: ChillEntity): boolean {
    const state = this.readCrudState(entity);
    return state === 'draft' || state === 'dirty' || state === 'saving' || state === 'error' || state === 'deleted';
  }

  /**
   * Checks if a row is deleted.
   */
  isDeletedRow(entity: ChillEntity): boolean {
    return this.readCrudState(entity) === 'deleted';
  }

  /**
   * Activates inline editing for a cell.
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
      isCommitting: false
    });
  }

  /**
   * Checks if a cell is currently being edited.
   */
  isCellEditing(entity: ChillEntity, column: TableColumn): boolean {
    const activeCellEdit = this.activeCellEdit();
    return !!activeCellEdit
      && activeCellEdit.entityKey === this.trackByEntity(0, entity)
      && activeCellEdit.propertyName === column.name;
  }

  /**
   * Handles changes to cell values during editing.
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
   * Handles changes to cell validity during editing.
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
   * Handles focus out event for cell editing, committing the edit.
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

    this.commitCellEdit();
  }

  /**
   * Handles keydown events in cell editor, committing or canceling on Enter/Escape.
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
   * Cancels the current cell edit.
   */
  cancelCellEdit(): void {
    this.activeCellEdit.set(null);
  }

  /**
   * Commits the current cell edit if valid and changed.
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
   * Returns field-specific validation errors for a row.
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
   * Checks if a row has any validation errors.
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
   * Syncs entity notification subscriptions based on schema and entities.
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
   * Clears all entity notification subscriptions.
   */
  private clearEntityNotificationSubscriptions(): void {
    for (const subscription of this.entityNotificationSubscriptions.values()) {
      subscription.unsubscribe();
    }

    this.entityNotificationSubscriptions.clear();
    this.subscribedNotificationChillType = '';
  }

  /**
   * Handles entity change notifications by refreshing displayed entities.
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
   * Refreshes a displayed entity with the latest data from the server.
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
   * Saves the current layout to the schema metadata.
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
   * Reads the layout state from schema metadata or returns default.
   */
  private readLayoutState(schema: ChillSchema | null): ColumnLayoutState[] {
    const properties = schema?.properties ?? [];
    const defaultLayout = properties.map((property) => ({
      name: property.name,
      displayName: property.displayName || property.name,
      hidden: false
    }));

    const metadata = this.readSchemaMetadata(schema);
    const rawLayout = metadata[TABLE_LAYOUT_METADATA_KEY]?.trim();
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
   * Normalizes the layout state for saving, ordering visible before hidden.
   */
  private normalizeLayoutForSave(layoutState: ColumnLayoutState[]): ColumnLayoutState[] {
    const visibleColumns = layoutState.filter((column) => !column.hidden);
    const hiddenColumns = layoutState.filter((column) => column.hidden);
    return [...visibleColumns, ...hiddenColumns];
  }

  /**
   * Reads schema metadata as a record of strings.
   */
  private readSchemaMetadata(schema: ChillSchema | null): Record<string, string> {
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
   * Reads a property value from an entity.
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
   * Reads a text value from an entity for a given key.
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
   * Reads the CRUD state of an entity as a string.
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
   * Reads the chill state from an entity.
   */
  private readChillState(entity: ChillEntity): JsonValue | undefined {
    return entity['chillState'];
  }

  /**
   * Reads the CRUD state object from an entity.
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
          ? typedState['dirtyProperties'].filter((propertyName): propertyName is string => typeof propertyName === 'string' && propertyName.trim().length > 0)
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
   * Updates an entity with a new CRUD state.
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
   * Sanitizes CRUD state by removing undefined values.
   */
  private sanitizeCrudState(state: Record<string, JsonValue | undefined>): JsonObject {
    return Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined)
    ) as JsonObject;
  }

  /**
   * Normalizes a server entity by resetting its CRUD state.
   */
  private normalizeServerEntity(entity: ChillEntity): ChillEntity {
    return this.withCrudState(entity, {
      isNew: false,
      status: 'pristine',
      dirtyProperties: null,
      validationErrors: null,
      genericErrors: null,
      errorMessage: null
    });
  }

  /**
   * Prepares an entity to match the schema properties.
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
   * Replaces a displayed entity with an updated one.
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
   * Checks if an entity is new.
   */
  private isNewEntity(entity: ChillEntity): boolean {
    return this.readCrudStateObject(entity).isNew === true;
  }

  /**
   * Reads the names of dirty controls from a form.
   */
  private readDirtyControlNames(form: FormGroup<Record<string, FormControl<JsonValue>>>): string[] {
    return Object.entries(form.controls)
      .filter(([, control]) => control.dirty)
      .map(([propertyName]) => propertyName.trim())
      .filter((propertyName) => propertyName.length > 0);
  }

  /**
   * Reads the GUID from an entity.
   */
  private readEntityGuid(entity: ChillEntity): string {
    return this.readEntityText(entity, 'guid')
      ?? this.readEntityText(entity, 'Guid')
      ?? '';
  }

  /**
   * Reads a string value from JSON.
   */
  private readStringValue(value: JsonValue | undefined): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  /**
   * Reads a boolean from the chill state.
   */
  private readChillStateBoolean(entity: ChillEntity, propertyName: string): boolean {
    const chillState = this.readChillState(entity);
    if (!chillState || typeof chillState !== 'object' || Array.isArray(chillState)) {
      return false;
    }

    return (chillState as JsonObject)[propertyName] === true;
  }

  /**
   * Checks if an entity's GUID matches the given GUID.
   */
  private sameEntityGuid(entity: ChillEntity, guid: string): boolean {
    return this.readEntityGuid(entity) === guid.trim();
  }

  /**
   * Converts a string to PascalCase.
   */
  private toPascalCase(value: string): string {
    return value.length > 0
      ? `${value[0].toUpperCase()}${value.slice(1)}`
      : value;
  }

  /**
   * Compares two JSON values for equality.
   */
  private areJsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  // #endregion
}
