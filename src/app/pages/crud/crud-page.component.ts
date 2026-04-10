import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillValidationError } from 'chill-sharp-ts-client';
import { firstValueFrom } from 'rxjs';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import { ChillFormComponent } from '../../lib/chill-form.component';
import { ChillTableComponent, type ChillTableCellEditCommitEvent, type ChillTableRowAction, type ChillTableSelectionColumn, type ChillTableValidationFocus } from '../../lib/chill-table.component';
import { CHILL_PROPERTY_TYPE, ChillEntityStatus, ChillState, type ChillEntity, type ChillEntityChangeNotification, type ChillFormSubmitEvent, type ChillQuery, type ChillSchema, type ChillSchemaListItem } from '../../models/chill-schema.models';
import { ChillService } from '../../services/chill.service';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { WorkspaceService } from '../../services/workspace.service';

const DEFAULT_VIEW_CODE = 'default';
const DEFAULT_PAGE_SIZE = 20;
const ENTITY_NOTIFICATION_IGNORE_WINDOW_MS = 1000;

export class CrudPageComponentConfiguration {
  ChillType = '';
  ChillQuery?: string | null;
  ViewCode?: string | null;
  DefaultValues?: Record<string, JsonValue> | null;
  FixedQueryValues?: Record<string, JsonValue> | null;
  DefaultQueryValues?: Record<string, JsonValue> | null;
  relations?: CrudPageComponentConfiguration[] | null;
}

@Component({
  selector: 'app-crud-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillTableComponent, ChillI18nLabelComponent],
  templateUrl: './crud-page.component.html',
  styleUrl: './crud-page.component.scss'
})
export class CrudPageComponent implements OnInit {
  
  //#region Service injection
  readonly chill = inject(ChillService);
  readonly dialog = inject(WorkspaceDialogService);
  readonly workspace = inject(WorkspaceService);
  //#endregion

  //#region Component inputs
  readonly selectionEnabled = input(false);
  readonly multipleSelection = input(false);
  readonly initialSelectedEntity = input<ChillEntity | null>(null);
  readonly initialSelectedEntities = input<ChillEntity[]>([]);
  readonly showTableHeader = input(true);
  readonly componentConfiguration = input<CrudPageComponentConfiguration | null>(null);
  //#endregion

  //#region Component state
  readonly isLoadingSchemaList = signal(true);
  readonly isLoadingSchema = signal(false);
  readonly isSearching = signal(false);
  readonly isSaving = signal(false);
  readonly errorMessage = signal('');
  readonly querySchemas = signal<ChillSchemaListItem[]>([]);
  readonly selectedQueryType = signal('');
  readonly querySchema = signal<ChillSchema | null>(null);
  readonly resultSchema = signal<ChillSchema | null>(null);
  readonly queryModel = signal<ChillQuery | null>(null);
  readonly results = signal<ChillEntity[]>([]);
  readonly selectedEntityKeys = signal<string[]>([]);
  readonly selectedViewCode = signal(DEFAULT_VIEW_CODE);
  readonly normalizedConfiguration = computed(() => this.normalizeComponentConfiguration(this.componentConfiguration()));
  readonly readonlyQueryPropertyNames = computed(() => [
    ...Object.keys(this.defaultQueryValues()),
    ...Object.keys(this.fixedQueryValues())
  ].filter((propertyName, index, values) => values.findIndex((value) => value === propertyName) === index));
  readonly currentPage = signal(1);
  readonly pageSize = DEFAULT_PAGE_SIZE;
  readonly validationErrorMessage = computed(() => {
    const messages = this.results()
      .flatMap((entity) => {
        const crudState = this.readChillStateObject(entity);
        if (!crudState || typeof crudState !== 'object' || Array.isArray(crudState)) {
          return [];
        }

        const genericErrors = (crudState as JsonObject)['genericErrors'];
        return Array.isArray(genericErrors)
          ? genericErrors.filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
          : [];
      });

    return [...new Set(messages)].join(' ').trim();
  });
  readonly validationFocus = computed<ChillTableValidationFocus | null>(() => {
    for (const entity of this.pagedResults()) {
      const crudState = this.readChillStateObject(entity);
      const fieldNames = Object.keys(crudState.validationErrors ?? {});
      if (fieldNames.length > 0) {
        return {
          entityKey: this.readEntityKey(entity),
          propertyName: fieldNames[0]
        };
      }
    }

    return null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.results().length / this.pageSize)));
  readonly pagedResults = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize;
    return this.results().slice(start, start + this.pageSize);
  });
  readonly rowActions = computed<ChillTableRowAction[]>(() => [
    {
      icon: 'edit',
      iconClass: 'material-symbol-icon',
      ariaLabel: this.chill.T('E64B6037-B83A-406A-B5D6-CB5AA6E42FC6', 'Edit row', 'Modifica riga'),
      disabled: (entity) => this.isSaving() || this.isDeletedEntity(entity),
      handler: (entity) => this.openEntityDialog(entity)
    },
    {
      icon: 'delete',
      iconClass: 'material-symbol-icon',
      ariaLabel: this.chill.T('704B4EC7-C971-48C7-9439-E08C2F590992', 'Delete row', 'Elimina riga'),
      disabled: (entity) => this.isSaving() || this.isDeletedEntity(entity),
      handler: (entity) => this.markEntityDeleted(entity)
    },
    ...this.createRelationRowActions()
  ]);
  readonly activeRowActions = computed<ChillTableRowAction[] | null>(() => this.selectionEnabled() ? null : this.rowActions());
  readonly selectionColumn = computed<ChillTableSelectionColumn | null>(() => this.selectionEnabled()
    ? {
        ariaLabel: this.chill.T('2EE7A0D9-CDE2-4F72-9BE1-B86A91D4B208', 'Select row', 'Seleziona riga'),
        isSelected: (entity) => this.isEntitySelected(entity),
        toggle: (entity, selected) => this.toggleSelectedEntity(entity, selected),
        disabled: () => this.isSaving()
      }
    : null);
  //#endregion

  // #region Public Methods

  /**
   * Initializes the component by setting up initial state and loading query schemas.
   */
  ngOnInit(): void {
    this.selectedViewCode.set(this.normalizeViewCode(this.normalizedConfiguration().ViewCode));
    this.selectedEntityKeys.set(this.readInitialSelectedEntityKeys());
    this.loadQuerySchemas();
  }

  /**
   * Determines if the selection can be confirmed based on the selection mode and selected entities.
   */
  canConfirmSelection(): boolean {
    return this.multipleSelection()
      ? this.selectedEntities().length > 0
      : !!this.selectedEntity();
  }

  /**
   * Returns the dialog result based on the selection mode.
   */
  dialogResult(): ChillEntity | ChillEntity[] | null {
    if (this.multipleSelection()) {
      return this.selectedEntities().map((entity) => this.cloneEntity(entity));
    }

    const entity = this.selectedEntity();
    return entity ? this.cloneEntity(entity) : null;
  }

  /**
   * Selects a query schema and loads the corresponding result schema.
   */
  selectQuerySchema(chillType: string): void {
    const normalizedType = chillType.trim();
    this.selectedQueryType.set(normalizedType);
    this.errorMessage.set('');
    this.results.set([]);
    this.currentPage.set(1);

    if (!normalizedType) {
      this.querySchema.set(null);
      this.resultSchema.set(null);
      this.queryModel.set(null);
      return;
    }

    this.loadSelectedSchema(normalizedType);
  }

  /**
   * Performs a search using the provided query form event.
   */
  search(event: ChillFormSubmitEvent): void {
    if (event.kind !== 'query') {
      return;
    }

    const query = this.normalizeQuery(event.value as ChillQuery);
    this.isSearching.set(true);
    this.errorMessage.set('');
    this.queryModel.set(query);

    this.chill.query(query).subscribe({
      next: (response) => {
        this.results.set(this.mergeWithDraftEntities(this.extractEntities(response)));
        this.currentPage.set(1);
        this.isSearching.set(false);
      },
      error: (error: unknown) => {
        this.results.set(this.pendingEntities());
        this.currentPage.set(1);
        this.errorMessage.set(this.chill.formatError(error));
        this.isSearching.set(false);
      }
    });
  }

  /**
   * Opens a search dialog for the current query schema.
   */
  openSearchDialog(): void {
    const schema = this.querySchema();
    if (!schema) {
      return;
    }

    void this.dialog.openDialog<void>({
      title: this.chill.T('44972777-6760-4F48-BE39-B504E4467150', 'Search', 'Cerca'),
      component: ChillFormComponent,
      okLabel: this.chill.T('D513421E-1C00-425E-A89B-E736A440474F', 'Search', 'Cerca'),
        inputs: {
          schema,
          query: this.queryModel(),
          readonlyPropertyNames: this.readonlyQueryPropertyNames(),
          submitLabelGuid: 'D513421E-1C00-425E-A89B-E736A440474F',
        submitPrimaryDefaultText: 'Search',
        submitSecondaryDefaultText: 'Cerca',
        submitLabel: this.chill.T('D513421E-1C00-425E-A89B-E736A440474F', 'Search', 'Cerca'),
        showSchemaHeader: false,
        renderSubmitInsideForm: false,
        onSubmit: (event: ChillFormSubmitEvent) => this.search(event),
        closeDialogOnSubmit: true
      }
    });
  }

  /**
   * Checks if the search dialog can be opened.
   */
  canOpenSearchDialog(): boolean {
    return !!this.querySchema() && !this.isLoadingSchema();
  }

  /**
   * Checks if a new entity can be added.
   */
  canAddEntity(): boolean {
    return !!this.resultSchema() && !this.isSaving() && !this.isLoadingSchema();
  }

  /**
   * Checks if there are any pending entities that need to be saved.
   */
  hasPendingEntities(): boolean {
    return this.results().some((entity) => this.isPendingEntity(entity));
  }

  /**
   * Saves all pending entities by validating and committing them.
   */
  async savePendingEntities(): Promise<void> {
    const schema = this.resultSchema();
    const pendingEntities = this.pendingEntities();
    if (!schema || pendingEntities.length === 0 || this.isSaving()) {
      return;
    }

    const entitiesToValidate = pendingEntities.filter((entity) => !this.isDeletedEntity(entity));
    const isValidationSuccessful = await this.validatePendingEntities(entitiesToValidate, schema);
    if (!isValidationSuccessful) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set('');
    this.updatePendingStatuses(pendingEntities, {
      status: 'saving'
    });
    const removableDraftKeys = new Set(
      pendingEntities
        .filter((entity) => this.isDraftEntity(entity) && this.isDeletedEntity(entity))
        .map((entity) => this.readEntityKey(entity))
        .filter((entityKey) => entityKey.length > 0)
    );
    const chunkOperations = this.buildChunkOperations(
      pendingEntities.filter((entity) => !removableDraftKeys.has(this.readEntityKey(entity))),
      schema
    );

    try {
      if (chunkOperations.length > 0) {
        await firstValueFrom(this.chill.chunk(chunkOperations));
      }

      const successfulEntityKeys = new Set(
        pendingEntities
          .map((entity) => this.readEntityKey(entity))
          .filter((entityKey) => entityKey.length > 0)
      );
      this.results.update((current) => current.filter((entity) => !successfulEntityKeys.has(this.readEntityKey(entity))));
      this.errorMessage.set('');
      this.refreshResults();
    } catch (error: unknown) {
      const errorMessage = this.chill.formatError(error);
      const failedEntityKeys = new Set(
        pendingEntities
          .map((entity) => this.readEntityKey(entity))
          .filter((entityKey) => entityKey.length > 0)
      );
      this.results.update((current) => current.map((entity) => failedEntityKeys.has(this.readEntityKey(entity))
        ? this.withCrudState(entity, {
            status: this.isDeletedEntity(entity) ? 'deleted' : 'error',
            errorMessage
          })
        : entity));
      this.errorMessage.set(errorMessage);
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Checks if navigation to the previous page is possible.
   */
  canGoToPreviousPage(): boolean {
    return this.currentPage() > 1;
  }

  /**
   * Checks if navigation to the next page is possible.
   */
  canGoToNextPage(): boolean {
    return this.currentPage() < this.totalPages();
  }

  /**
   * Navigates to the previous page.
   */
  goToPreviousPage(): void {
    if (!this.canGoToPreviousPage()) {
      return;
    }

    this.currentPage.update((page) => Math.max(1, page - 1));
  }

  /**
   * Navigates to the next page.
   */
  goToNextPage(): void {
    if (!this.canGoToNextPage()) {
      return;
    }

    this.currentPage.update((page) => Math.min(this.totalPages(), page + 1));
  }

  /**
   * Returns the label for the current page.
   */
  pageLabel(): string {
    return this.chill.T('A28A7E16-5B47-4B5D-A5CF-54BDEFF43073', `Page ${this.currentPage()} of ${this.totalPages()}`, `Pagina ${this.currentPage()} di ${this.totalPages()}`);
  }

  /**
   * Clears the error message.
   */
  clearErrorMessage(): void {
    this.errorMessage.set('');
  }

  /**
   * Opens a dialog for editing or adding an entity.
   */
  openEntityDialog(entity: ChillEntity): void {
    const schema = this.resultSchema();
    if (!schema) {
      return;
    }
    const isDraft = this.isNewEntity(entity);
    void (async () => {
      const result = await this.dialog.openDialog<ChillEntity>({
        title: isDraft
          ? this.chill.T('23A5536E-8A94-4469-977C-D3BB57E5E621', 'Add', 'Aggiungi')
          : this.chill.T('E64B6037-B83A-406A-B5D6-CB5AA6E42FC6', 'Edit', 'Modifica'),
        component: ChillFormComponent,
        okLabel: isDraft
          ? this.chill.T('D7EA89E2-4AF2-455A-8FA9-33540E61D7C5', 'Done', 'Fine')
          : this.chill.T('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Update', 'Aggiorna'),
        inputs: {
          schema,
          entity: this.prepareDialogEntity(entity, schema),
          submitLabelGuid: isDraft ? 'D7EA89E2-4AF2-455A-8FA9-33540E61D7C5' : '62953302-B951-4FD1-BD08-4B7649A91BAF',
          submitPrimaryDefaultText: isDraft ? 'Done' : 'Update',
          submitSecondaryDefaultText: isDraft ? 'Fine' : 'Aggiorna',
          submitLabel: isDraft
            ? this.chill.T('D7EA89E2-4AF2-455A-8FA9-33540E61D7C5', 'Done', 'Fine')
            : this.chill.T('62953302-B951-4FD1-BD08-4B7649A91BAF', 'Update', 'Aggiorna'),
          showSchemaHeader: false,
          renderSubmitInsideForm: false,
          closeDialogOnSubmit: false
        }
      });

      if (result.status !== 'confirmed') {
        return;
      }

      const savedEntity = result.value;
      if (!savedEntity) {
        if (isDraft) {
          this.removeIsNewEntity(entity);
        } else {
          this.refreshResults();
        }
        return;
      }

      const nextEntity = this.prepareSavedDialogEntity(savedEntity, schema);
      this.replaceEntity(nextEntity, this.findEntityByKey(entity) ?? entity);
    })();
  }

  private loadQuerySchemas(): void {
    this.isLoadingSchemaList.set(true);
    this.errorMessage.set('');

    this.chill.getSchemaList().subscribe({
      next: (schemaList) => {
        const querySchemas = schemaList
          .filter((item) => this.isQuerySchema(item))
          .sort((left, right) => this.schemaLabel(left).localeCompare(this.schemaLabel(right)));

        this.querySchemas.set(querySchemas);
        this.isLoadingSchemaList.set(false);

        if (querySchemas.length === 0) {
          this.errorMessage.set(this.chill.T('9A6E134E-44BF-4FF4-97DF-EE3041286395', 'No query schemas are available.', 'Nessuno schema di query disponibile.'));
          return;
        }

        const configuredQueryType = this.configuredQueryChillType();
        const configuredResultType = this.configuredResultChillType();
        const initialSchema = querySchemas.find((schema) => schema.chillType?.trim() === configuredQueryType)
          ?? querySchemas.find((schema) => schema.relatedChillType?.trim() === configuredResultType)
          ?? null;
        
        if (!initialSchema) {
          this.errorMessage.set(this.chill.T('5C237896-63A2-4E59-809A-12598DC24882', 'No query schemas are available.', 'Nessuno schema di query disponibile.'));
          return;
        }
        this.selectQuerySchema(initialSchema.chillType?.trim() ?? '');
      },
      error: (error: unknown) => {
        this.querySchemas.set([]);
        this.errorMessage.set(this.chill.formatError(error));
        this.isLoadingSchemaList.set(false);
      }
    });
  }

  private loadSelectedSchema(chillType: string): void {
    this.isLoadingSchema.set(true);

    const viewCode = this.selectedViewCode();
    this.chill.getSchema(chillType, viewCode).subscribe({
      next: (schema) => {
        if (!schema) {
          this.querySchema.set(null);
          this.resultSchema.set(null);
          this.queryModel.set(null);
          this.results.set([]);
          this.errorMessage.set(this.chill.T('80085620-C926-4F8C-820D-672EE1E7B4AF', 'The selected query schema is unavailable.', 'Lo schema di query selezionato non è disponibile.'));
          this.isLoadingSchema.set(false);
          return;
        }

        this.querySchema.set(schema);
        this.queryModel.set(this.createQueryModel(schema));
        void this.loadResultSchema(
          this.configuredResultChillType() || schema.queryRelatedChillType?.trim() || '',
          schema.chillViewCode?.trim() || viewCode
        );
      },
      error: (error: unknown) => {
        this.querySchema.set(null);
        this.resultSchema.set(null);
        this.queryModel.set(null);
        this.results.set([]);
        this.errorMessage.set(this.chill.formatError(error));
        this.isLoadingSchema.set(false);
      }
    });
  }

  /**
   * Adds a new draft entity to the results.
   */
  add(): void {
    const schema = this.resultSchema();
    if (!schema) {
      return;
    }

    this.errorMessage.set('');
    const isNew = true;
    const draftEntity: ChillEntity = {
      guid: crypto.randomUUID(),
      chillState: {
        isNew: isNew,
        isDeleting: false,
        status: 'draft',
        dirtyProperties: []
      } satisfies ChillState,
      chillType: schema.chillType?.trim() ?? '',
      properties: {
        ...this.defaultEntityValues()
      }
    };
    this.results.update((current) => [...current, this.prepareEntityForSchema(draftEntity, schema, isNew)]);
    if (this.selectionEnabled()) {
      this.toggleSelectedEntity(draftEntity, true);
    }
  }

  /**
   * Handles inline cell edit commits from the table.
   */
  async handleInlineCellEdit(event: ChillTableCellEditCommitEvent): Promise<void> {
    const schema = this.resultSchema();
    if (!schema) {
      return;
    }

    const updatedEntity = this.mergeEntityProperty(event.entity, event.propertyName, event.value, schema);
    if (this.isNewEntity(event.entity)) {
      const nextEntity = this.withCrudState(updatedEntity, {
        status: 'draft',
        isNew: true,
        dirtyProperties: this.normalizeDirtyProperties(event.dirtyProperties),
        validationErrors: null,
        genericErrors: null
      });
      this.replaceEntity(nextEntity, event.entity);
      await this.autocompleteAndValidateEntity(nextEntity);
      return;
    }

    this.errorMessage.set('');
    const nextEntity = this.withCrudState(updatedEntity, {
      status: 'dirty',
      dirtyProperties: this.normalizeDirtyProperties(event.dirtyProperties),
      validationErrors: null,
      genericErrors: null
    });
    this.replaceEntity(nextEntity, event.entity);
    await this.autocompleteAndValidateEntity(nextEntity);
  }

  // #endregion

  // #region Helper Methods

  private async loadResultSchema(relatedChillType: string, chillViewCode: string): Promise<void> {
    if (!relatedChillType) {
      this.resultSchema.set(null);
      this.errorMessage.set(this.chill.T('C187D4C0-DB14-476E-9A40-F6D086C2D7A5', 'The selected query schema does not define QueryRelatedChillType.', 'Lo schema di query selezionato non definisce QueryRelatedChillType.'));
      this.isLoadingSchema.set(false);
      return;
    }

    this.chill.getSchema(relatedChillType, chillViewCode).subscribe({
      next: (schema) => {
        this.resultSchema.set(schema);
        if (!schema) {
          this.errorMessage.set(this.chill.T('A6A6949E-F0D4-42F5-A8AE-E15B1B174084', 'The result schema is unavailable.', 'Lo schema dei risultati non è disponibile.'));
        }
        if (schema && this.queryModel()) {
          this.isLoadingSchema.set(false);
          this.refreshResults();
          return;
        }
        this.isLoadingSchema.set(false);
      },
      error: (error: unknown) => {
        this.resultSchema.set(null);
        this.errorMessage.set(this.chill.formatError(error));
        this.isLoadingSchema.set(false);
      }
    });
  }

  markEntityDeleted(entity: ChillEntity): void {
    this.errorMessage.set('');
    this.results.update((current) => current.map((candidate) => this.readEntityKey(candidate) === this.readEntityKey(entity)
      ? this.withCrudState(candidate, {
          status: 'deleted'
        })
      : candidate));
  }

  private createQueryModel(schema: ChillSchema): ChillQuery {
    return this.normalizeQuery({
      chillType: this.configuredQueryChillType() || schema.chillType?.trim() || this.selectedQueryType(),
      properties: {
        ...this.defaultQueryValues(),
        ...this.fixedQueryValues()
      }
    });
  }

  private normalizeQuery(query: ChillQuery): ChillQuery {
    const resultSchema = this.resultSchema();
    return {
      ...query,
      chillType: query.chillType?.trim() || this.configuredQueryChillType() || this.querySchema()?.chillType?.trim() || this.selectedQueryType(),
      properties: {
        ...(query.properties ?? {}),
        ...this.defaultQueryValues(),
        ...this.fixedQueryValues()
      },
      resultProperties: resultSchema?.properties?.map((property) => ({ PropertyName: property.name })) ?? []
    };
  }

  private normalizeCreateEntity(entity: ChillEntity, schema: ChillSchema): ChillEntity {
    const preparedEntity = this.prepareEntityForSchema(entity, schema);
    const entityChillType = this.readStringValue(preparedEntity['chillType']);
    const { chillState: _chillState, ...normalizedEntity } = preparedEntity as ChillEntity & {
      chillState?: ChillState;
    };
    return {
      ...normalizedEntity,
      chillType: entityChillType || schema.chillType?.trim() || this.querySchema()?.queryRelatedChillType?.trim() || '',
      properties: {
        ...(preparedEntity.properties ?? {})
      }
    };
  }

  private buildChunkOperations(entities: ChillEntity[], schema: ChillSchema): JsonObject[] {
    if (entities.length === 0) {
      return [];
    }

    const operations: JsonObject[] = [{
      Index: 0,
      Verb: 'transaction'
    }];

    entities.forEach((entity, index) => {
      const normalizedEntity = this.normalizeCreateEntity(entity, schema) as JsonObject;
      const verb = this.isDeletedEntity(entity)
        ? 'delete'
        : this.isNewEntity(entity)
          ? 'create'
          : 'update';
      operations.push({
        Index: index + 1,
        Verb: verb,
        Entity: normalizedEntity
      });
    });

    operations.push({
      Index: operations.length,
      Verb: 'commit'
    });

    return operations;
  }

  private refreshResults(): void {
    const query = this.queryModel();
    if (!query) {
      return;
    }

    this.isSearching.set(true);
    this.chill.query(this.normalizeQuery(query)).subscribe({
      next: (response) => {
        this.results.set(this.mergeWithDraftEntities(this.extractEntities(response)));
        this.currentPage.set(1);
        this.isSearching.set(false);
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.chill.formatError(error));
        this.currentPage.set(1);
        this.isSearching.set(false);
      }
    });
  }

  private removeIsNewEntity(entity: ChillEntity): void {
    const isNew = this.isNewEntity(entity);
    if (!isNew) {
      return;
    }

    this.results.update((current) => current.filter((candidate) => this.isNewEntity(candidate) && candidate.guid !== entity.guid));
  }

  private isDraftEntity(entity: ChillEntity): boolean {
    return this.isNewEntity(entity);
  }

  private pendingEntities(): ChillEntity[] {
    return this.results().filter((entity) => this.isPendingEntity(entity));
  }

  private mergeWithDraftEntities(serverEntities: ChillEntity[]): ChillEntity[] {
    const pendingEntities = this.pendingEntities();
    const persistedPendingEntityMap = new Map(
      pendingEntities
        .filter((entity) => !this.isDraftEntity(entity))
        .map((entity) => [this.readEntityKey(entity), entity] as const)
    );

    return [
      ...serverEntities.map((entity) => persistedPendingEntityMap.get(this.readEntityKey(entity)) ?? entity),
      ...pendingEntities.filter((entity) => this.isDraftEntity(entity))
    ];
  }

  private updatePendingStatuses(entities: ChillEntity[], state: Partial<ChillState>): void {
    const entityKeys = new Set(entities.map((entity) => this.readEntityKey(entity)).filter((entityKey) => entityKey.length > 0));
    this.results.update((current) => current.map((entity) => entityKeys.has(this.readEntityKey(entity))
      ? this.withCrudState(entity, state)
      : entity));
  }

  private isPendingEntity(entity: ChillEntity): boolean {
    const status = this.readCrudStatus(entity);
    return status === 'draft' || status === 'dirty' || status === 'deleted' || status === 'error';
  }

  private isDeletedEntity(entity: ChillEntity): boolean {
    return this.readCrudStatus(entity) === 'deleted';
  }

  private readEntityKey(entity: ChillEntity): string {
    return this.readStringValue(entity['guid'])
      || this.readStringValue(entity['Guid']);
  }

  private withCrudState(entity: ChillEntity, state: Partial<ChillState>): ChillEntity {
    const nextState = this.sanitizeCrudState({
      ...this.readChillStateObject(entity),
      ...state
    });

    return {
      ...entity,
      chillState: {
        ...(this.readChillStateObject(entity) ?? {}),
        ...nextState,
        isNew: nextState.isNew,
        isDeleting: nextState.status === 'deleted'
      }
    };
  }

  private cloneEntity(entity: ChillEntity): ChillEntity {
    return {
      ...entity,
      properties: {
        ...(entity.properties ?? {})
      },
      ...(entity.chillState
        ? {
            chillState: { ...entity.chillState }
          }
        : {}),
      chillState: this.sanitizeCrudState({
        ...this.readChillStateObject(entity),
        isDeleting: this.readChillStateObject(entity).status === 'deleted'
      })
    };
  }

  private readCrudStatus(entity: ChillEntity): ChillEntityStatus | '' {
    const status = this.readChillStateObject(entity).status;
    return status === 'pristine' || status === 'draft' || status === 'dirty' || status === 'saving' || status === 'deleted' || status === 'error'
      ? status
      : '';
  }

  private mergeEntityProperty(entity: ChillEntity, propertyName: string, value: JsonValue, schema: ChillSchema): ChillEntity {
    const currentProperties = {
      ...(entity.properties ?? {})
    };

    return {
      ...entity,
      properties: {
        ...currentProperties,
        [propertyName]: this.chill.toJsonValue(schema, propertyName, value)
      }
    };
  }

  private async autocompleteAndValidateEntity(entity: ChillEntity): Promise<void> {
    const schema = this.resultSchema();
    if (!schema) {
      return;
    }

    let currentEntity = entity;
    try {
      const autocompletedEntity = await firstValueFrom(this.chill.autocomplete(this.normalizeCreateEntity(entity, schema) as JsonObject));
      const autocompletedFields = this.extractValidationEntityFields(autocompletedEntity, schema);
      if (Object.keys(autocompletedFields).length > 0) {
        currentEntity = this.withCrudState({
          ...currentEntity,
          properties: {
            ...(currentEntity.properties ?? {}),
            ...autocompletedFields
          }
        }, this.readChillStateObject(currentEntity));
        this.replaceEntity(currentEntity, entity);
      }
    } catch {
      currentEntity = this.findEntityByKey(currentEntity) ?? currentEntity;
    }

    const updatedEntity = this.withCrudState(currentEntity, {
      ...this.readChillStateObject(currentEntity),
      validationErrors: null,
      genericErrors: null
    });
    this.replaceEntity(updatedEntity, currentEntity);
  }

  private async validatePendingEntities(entities: ChillEntity[], schema: ChillSchema): Promise<boolean> {
    if (entities.length === 0) {
      return true;
    }

    let hasErrors = false;
    let firstInvalidIndex = -1;

    for (const [index, entity] of entities.entries()) {
      try {
        const validationErrors = await firstValueFrom(this.chill.validate(this.normalizeCreateEntity(entity, schema) as JsonObject));
        const partitionedErrors = this.partitionValidationErrors(validationErrors, schema);
        const hasEntityErrors = Object.keys(partitionedErrors.fieldErrors).length > 0 || partitionedErrors.genericErrors.length > 0;
        if (hasEntityErrors) {
          hasErrors = true;
          if (firstInvalidIndex < 0) {
            firstInvalidIndex = index;
          }
        }

        const nextEntity = this.withCrudState(entity, {
          ...this.readChillStateObject(entity),
          validationErrors: Object.keys(partitionedErrors.fieldErrors).length > 0 ? partitionedErrors.fieldErrors : null,
          genericErrors: partitionedErrors.genericErrors.length > 0 ? partitionedErrors.genericErrors : null
        });
        this.replaceEntity(nextEntity, entity);
      } catch (error: unknown) {
        hasErrors = true;
        if (firstInvalidIndex < 0) {
          firstInvalidIndex = index;
        }

        const nextEntity = this.withCrudState(entity, {
          ...this.readChillStateObject(entity),
          genericErrors: [this.chill.formatError(error)],
          validationErrors: null
        });
        this.replaceEntity(nextEntity, entity);
      }
    }

    if (firstInvalidIndex >= 0) {
      const firstInvalidEntity = entities[firstInvalidIndex];
      const absoluteIndex = this.results().findIndex((entity) => this.readEntityKey(entity) === this.readEntityKey(firstInvalidEntity));
      if (absoluteIndex >= 0) {
        this.currentPage.set(Math.floor(absoluteIndex / this.pageSize) + 1);
      }
    }

    return !hasErrors;
  }

  private replaceEntity(nextEntity: ChillEntity, previousEntity: ChillEntity): void {
    const previousEntityKey = this.readEntityKey(previousEntity);
    this.results.update((current) => current.map((entity) => this.readEntityKey(entity) === previousEntityKey ? nextEntity : entity));
  }

  private findEntityByKey(entity: ChillEntity): ChillEntity | null {
    const entityKey = this.readEntityKey(entity);
    return this.results().find((candidate) => this.readEntityKey(candidate) === entityKey) ?? null;
  }

  // private readChillStateObject(entity: ChillEntity): ChillState {
  //   const currentState = this.readChillStateValue(entity);
  //   const chillState = this.readChillStateObject(entity);
  //   const isNew = chillState?.['isNew'] === true;
  //   const isDeleting = chillState?.['isDeleting'] === true;
  //   if (currentState && typeof currentState === 'object' && !Array.isArray(currentState)) {
  //     const typedState = currentState as ChillState;
  //     const resolvedIsNew = typedState.isNew === true || isNew;
  //     const resolvedStatus = typedState.status === 'pristine' || typedState.status === 'draft' || typedState.status === 'dirty' || typedState.status === 'saving' || typedState.status === 'deleted' || typedState.status === 'error'
  //       ? typedState.status
  //       : (resolvedIsNew ? 'draft' : isDeleting ? 'deleted' : 'pristine');
  //     return {
  //       isNew: resolvedIsNew,
  //       status: resolvedStatus,
  //       errorMessage: typedState.errorMessage ?? null,
  //       validationErrors: typedState.validationErrors ?? null,
  //       genericErrors: typedState.genericErrors ?? null,
  //       dirtyProperties: Array.isArray(typedState.dirtyProperties)
  //         ? typedState.dirtyProperties.filter((propertyName): propertyName is string => typeof propertyName === 'string' && propertyName.trim().length > 0)
  //         : null
  //     };
  //   }

  //   return {
  //     isNew,
  //     status: isNew ? 'draft' : isDeleting ? 'deleted' : 'pristine',
  //     dirtyProperties: isNew ? [] : null
  //   };
  // }

  private isNewEntity(entity: ChillEntity): boolean {
    return this.readChillStateObject(entity)?.isNew ?? false;
  }

  private prepareEntityForSchema(entity: ChillEntity, schema: ChillSchema, isNew: boolean = false): ChillEntity {
    const clonedEntity = this.cloneEntity(entity);
    const nextProperties: Record<string, JsonValue> = {
      ...(isNew ? this.defaultEntityValues() : {}),
      ...(clonedEntity.properties ?? {})
    };

    for (const property of schema.properties ?? []) {
      if (property.name in nextProperties) {
        continue;
      }

      nextProperties[property.name] = this.readEntityPropertyValue(clonedEntity, property.name) ?? null;

      if (!property.isNullable && nextProperties[property.name] === null)
      {
        if (property.propertyType == CHILL_PROPERTY_TYPE.Boolean)
          nextProperties[property.name] = false;
        else if (property.propertyType == CHILL_PROPERTY_TYPE.Integer)
          nextProperties[property.name] = 0;
        else if (property.propertyType == CHILL_PROPERTY_TYPE.Decimal)
          nextProperties[property.name] = 0;
        else if (property.propertyType == CHILL_PROPERTY_TYPE.String)
          nextProperties[property.name] = '';
      }

    }

    return {
      ...clonedEntity,
      chillType: this.readStringValue(clonedEntity['chillType']) || schema.chillType?.trim() || this.querySchema()?.queryRelatedChillType?.trim() || '',
      properties: nextProperties
    };
  }

  private readEntityPropertyValue(entity: ChillEntity, propertyName: string): JsonValue | undefined {
    const properties = entity.properties;
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    if (propertyName in entity) {
      return entity[propertyName];
    }

    const pascalCaseName = propertyName.length > 0
      ? `${propertyName[0].toUpperCase()}${propertyName.slice(1)}`
      : propertyName;
    return entity[pascalCaseName];
  }

  private sanitizeCrudState(state: Record<string, JsonValue | undefined>): ChillState {
    return Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined)
    ) as ChillState;
  }

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

  private prepareDialogEntity(entity: ChillEntity, schema: ChillSchema): ChillEntity {
    const preparedEntity = this.prepareEntityForSchema(entity, schema);
    if (this.isNewEntity(entity)) {
      return this.withCrudState(preparedEntity, {
        ...this.readChillStateObject(preparedEntity),
        status: 'draft',
        dirtyProperties: this.normalizeDirtyProperties(this.readChillStateObject(preparedEntity).dirtyProperties),
        validationErrors: null,
        genericErrors: null,
        errorMessage: null,
        ignoreNotificationsUntil: null
      });
    }

    return this.withCrudState(preparedEntity, {
      ...this.readChillStateObject(preparedEntity),
      status: 'pristine',
      dirtyProperties: null,
      validationErrors: null,
      genericErrors: null,
      errorMessage: null,
      ignoreNotificationsUntil: null
    });
  }

  private prepareSavedDialogEntity(entity: ChillEntity, schema: ChillSchema): ChillEntity {
    return this.withCrudState(
      this.normalizeServerEntity(this.prepareEntityForSchema(entity, schema)),
      {
        ignoreNotificationsUntil: Date.now() + ENTITY_NOTIFICATION_IGNORE_WINDOW_MS
      }
    );
  }

  private readChillStateObject(entity: ChillEntity): ChillState {
    const chillState = entity['chillState'] as ChillState | null;
    return chillState && typeof chillState === 'object' && !Array.isArray(chillState)
      ? chillState as ChillState
      : { } as ChillState;
  }


  private normalizeDirtyProperties(propertyNames: string[] | null | undefined): string[] | null {
    const normalizedPropertyNames = (propertyNames ?? [])
      .map((propertyName) => propertyName.trim())
      .filter((propertyName) => propertyName.length > 0);
    return normalizedPropertyNames.length > 0
      ? [...new Set(normalizedPropertyNames)]
      : null;
  }

  private extractValidationEntityFields(source: JsonObject, schema: ChillSchema): Record<string, JsonValue> {
    const nextFields: Record<string, JsonValue> = {};
    for (const property of schema.properties ?? []) {
      const fieldName = property.name;
      const propertiesValue = source['properties'];
      if (propertiesValue && typeof propertiesValue === 'object' && !Array.isArray(propertiesValue) && fieldName in propertiesValue) {
        nextFields[fieldName] = (propertiesValue as Record<string, JsonValue>)[fieldName];
        continue;
      }

      const pascalPropertiesValue = source['Properties'];
      if (pascalPropertiesValue && typeof pascalPropertiesValue === 'object' && !Array.isArray(pascalPropertiesValue) && fieldName in pascalPropertiesValue) {
        nextFields[fieldName] = (pascalPropertiesValue as Record<string, JsonValue>)[fieldName];
      }
    }
    return nextFields;
  }

  private partitionValidationErrors(
    errors: ChillValidationError[],
    schema: ChillSchema
  ): { fieldErrors: Record<string, string>; genericErrors: string[] } {
    const propertyNameMap = new Map(
      (schema.properties ?? [])
        .map((property) => property.name.trim())
        .filter((propertyName) => propertyName.length > 0)
        .map((propertyName) => [propertyName.toLowerCase(), propertyName] as const)
    );
    const fieldErrors: Record<string, string> = {};
    const genericErrors: string[] = [];

    for (const error of errors) {
      const fieldName = typeof error.fieldName === 'string' ? error.fieldName.trim() : '';
      const message = typeof error.message === 'string' ? error.message.trim() : '';
      if (!message) {
        continue;
      }

      const resolvedFieldName = fieldName ? propertyNameMap.get(fieldName.toLowerCase()) : undefined;
      if (resolvedFieldName) {
        fieldErrors[resolvedFieldName] = fieldErrors[resolvedFieldName]
          ? `${fieldErrors[resolvedFieldName]} ${message}`
          : message;
        continue;
      }

      genericErrors.push(message);
    }

    return { fieldErrors, genericErrors };
  }

  private extractEntities(response: JsonObject): ChillEntity[] {
    const candidates = [
      response,
      response['results'],
      response['entities'],
      response['items'],
      response['value'],
      response['data']
    ];

    for (const candidate of candidates) {
      const entities = this.toEntityArray(candidate);
      if (entities.length > 0) {
        return entities.map((entity) => this.normalizeServerEntity(entity));
      }
    }

    return [];
  }

  private toEntityArray(value: JsonValue | undefined): ChillEntity[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ChillEntity => this.isJsonObject(item));
  }

  private isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private readStringValue(value: JsonValue | undefined): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  private configuredResultChillType(): string {
    return this.normalizedConfiguration().ChillType?.trim() || '';
  }

  private configuredQueryChillType(): string {
    return this.normalizedConfiguration().ChillQuery?.trim() || '';
  }

  private defaultEntityValues(): Record<string, JsonValue> {
    return this.resolveConfigRecord(this.normalizedConfiguration().DefaultValues);
  }

  private defaultQueryValues(): Record<string, JsonValue> {
    return this.resolveConfigRecord(this.normalizedConfiguration().DefaultQueryValues);
  }

  private fixedQueryValues(): Record<string, JsonValue> {
    return this.resolveConfigRecord(this.normalizedConfiguration().FixedQueryValues);
  }

  private relations(): CrudPageComponentConfiguration[] {
    return this.normalizedConfiguration().relations ?? [];
  }

  private normalizeComponentConfiguration(configuration: CrudPageComponentConfiguration | null): CrudPageComponentConfiguration {
    const normalizedConfiguration = new CrudPageComponentConfiguration();
    if (!configuration) {
      return normalizedConfiguration;
    }

    normalizedConfiguration.ChillType = this.readConfigString(configuration['ChillType']);
    normalizedConfiguration.ChillQuery = this.readConfigString(configuration['ChillQuery']) || null;
    normalizedConfiguration.ViewCode = this.readConfigString(configuration['ViewCode']) || null;
    normalizedConfiguration.DefaultValues = this.readConfigRecord(configuration['DefaultValues']);
    normalizedConfiguration.FixedQueryValues = this.readConfigRecord(configuration['FixedQueryValues']);
    normalizedConfiguration.DefaultQueryValues = this.readConfigRecord(configuration['DefaultQueryValues']);
    normalizedConfiguration.relations = this.readRelationConfigurations(configuration['relations']);
    return normalizedConfiguration;
  }

  private readConfigString(value: unknown): string {
    return typeof value === 'string'
      ? value.trim()
      : '';
  }

  private readConfigRecord(value: unknown): Record<string, JsonValue> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, JsonValue>)
        .map(([key, entryValue]) => [key.trim(), entryValue] as const)
        .filter(([key]) => key.length > 0)
    );
  }

  private readRelationConfigurations(value: unknown): CrudPageComponentConfiguration[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.normalizeComponentConfiguration(this.isJsonObject(entry)
        ? entry as unknown as CrudPageComponentConfiguration
        : null))
      .filter((entry) => entry.ChillType.trim().length > 0);
  }

  private createRelationRowActions(): ChillTableRowAction[] {
    return this.relations().map((relation, index) => ({
      icon: 'account_tree',
      iconClass: 'material-symbol-icon',
      ariaLabel: this.relationActionLabel(relation, index),
      disabled: (entity) => this.isSaving() || this.isDeletedEntity(entity),
      handler: (entity) => this.openRelation(entity, relation)
    }));
  }

  private openRelation(entity: ChillEntity, relation: CrudPageComponentConfiguration): void {
    const resolvedRelation = this.resolveRelationConfiguration(relation, entity);
    const chillType = resolvedRelation.ChillType.trim();
    if (!chillType) {
      return;
    }

    this.workspace.openCrudTask({
      chillType,
      queryChillType: resolvedRelation.ChillQuery,
      viewCode: resolvedRelation.ViewCode,
      componentConfiguration: resolvedRelation
    });
  }

  private resolveRelationConfiguration(
    configuration: CrudPageComponentConfiguration,
    entity: ChillEntity
  ): CrudPageComponentConfiguration {
    return {
      ChillType: configuration.ChillType,
      ChillQuery: configuration.ChillQuery ?? null,
      ViewCode: configuration.ViewCode ?? null,
      DefaultValues: this.resolveConfigRecord(configuration.DefaultValues, entity),
      FixedQueryValues: this.resolveConfigRecord(configuration.FixedQueryValues, entity),
      DefaultQueryValues: this.resolveConfigRecord(configuration.DefaultQueryValues, entity),
      relations: (configuration.relations ?? []).map((relation) => this.resolveRelationConfiguration(relation, entity))
    };
  }

  private relationActionLabel(relation: CrudPageComponentConfiguration, index: number): string {
    const chillType = relation.ChillType.trim();
    return chillType
      ? this.chill.T(
          `crud-relation-${index + 1}`,
          `Open related ${chillType}`,
          `Apri collegata ${chillType}`
        )
      : this.chill.T(
          `crud-relation-${index + 1}`,
          'Open related CRUD',
          'Apri CRUD collegata'
        );
  }

  private resolveConfigRecord(
    value: Record<string, JsonValue> | null | undefined,
    entity?: ChillEntity | null
  ): Record<string, JsonValue> {
    if (!value) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, this.resolveConfigValue(entryValue, entity)] as const)
    );
  }

  private resolveConfigValue(value: JsonValue, entity?: ChillEntity | null): JsonValue {
    if (typeof value !== 'string') {
      return value;
    }

    const placeholderMatch = /^@\{(.+)\}$/.exec(value.trim());
    if (!placeholderMatch) {
      return value;
    }

    const token = placeholderMatch[1].trim();
    if (!token) {
      return value;
    }

    if (!entity) {
      return null;
    }

    if (token.toLowerCase() === 'mock') {
      return this.createEntityMock(entity);
    }

    return this.readEntityPropertyValue(entity, token) ?? null;
  }

  private createEntityMock(entity: ChillEntity): ChillEntity {
    const clonedEntity = this.cloneEntity(entity);
    const guid = this.readEntityKey(clonedEntity);
    const chillType = this.readStringValue(clonedEntity['chillType']);
    const label = this.readStringValue(clonedEntity['label']);
    return {
      ...(guid ? { guid } : {}),
      ...(chillType ? { chillType } : {}),
      ...(label ? { label } : {}),
      properties: {
        ...(clonedEntity.properties ?? {})
      }
    };
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

  schemaLabel(item: ChillSchemaListItem): string {
    return item.displayName?.trim() || item.name?.trim() || item.chillType?.trim() || '';
  }

  private normalizeViewCode(value: string | null | undefined): string {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : DEFAULT_VIEW_CODE;
  }

  private isEntitySelected(entity: ChillEntity): boolean {
    const entityKey = this.readEntityKey(entity);
    return !!entityKey && this.selectedEntityKeys().includes(entityKey);
  }

  private toggleSelectedEntity(entity: ChillEntity, selected: boolean): void {
    const entityKey = this.readEntityKey(entity);
    if (!entityKey) {
      return;
    }

    this.selectedEntityKeys.update((current) => {
      if (this.multipleSelection()) {
        if (selected) {
          return current.includes(entityKey) ? current : [...current, entityKey];
        }

        return current.filter((value) => value !== entityKey);
      }

      return selected ? [entityKey] : [];
    });
  }

  private selectedEntity(): ChillEntity | null {
    return this.selectedEntities()[0] ?? null;
  }

  private selectedEntities(): ChillEntity[] {
    const selectedEntityKeys = this.selectedEntityKeys();
    if (selectedEntityKeys.length === 0) {
      return [];
    }

    const selectedEntityMap = new Map<string, ChillEntity>();
    for (const entity of this.results()) {
      const entityKey = this.readEntityKey(entity);
      if (entityKey && selectedEntityKeys.includes(entityKey)) {
        selectedEntityMap.set(entityKey, entity);
      }
    }

    for (const entity of this.readInitialSelectedEntities()) {
      const entityKey = this.readEntityKey(entity);
      if (entityKey && selectedEntityKeys.includes(entityKey) && !selectedEntityMap.has(entityKey)) {
        selectedEntityMap.set(entityKey, entity);
      }
    }

    return selectedEntityKeys
      .map((entityKey) => selectedEntityMap.get(entityKey) ?? null)
      .filter((entity): entity is ChillEntity => entity !== null);
  }

  private readInitialSelectedEntityKeys(): string[] {
    const selectedKeys = this.readInitialSelectedEntities()
      .map((entity) => this.readEntityKey(entity))
      .filter((entityKey) => entityKey.length > 0);
    return [...new Set(selectedKeys)];
  }

  private readInitialSelectedEntities(): ChillEntity[] {
    if (this.multipleSelection()) {
      return this.initialSelectedEntities();
    }

    const initialSelectedEntity = this.initialSelectedEntity();
    return initialSelectedEntity ? [initialSelectedEntity] : [];
  }

  // #endregion
}
