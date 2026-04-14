import { Component, OnDestroy, effect, inject, input, viewChild } from '@angular/core';
import { CrudPageComponent, type CrudPageComponentConfiguration } from '../../pages/crud/crud-page.component';
import type { ChillEntity } from '../../models/chill-schema.models';
import type { WorkspaceTaskConfiguration } from '../../models/workspace-task.models';
import { ChillService } from '../../services/chill.service';
import { WorkspaceDialogService } from '../../services/workspace-dialog.service';
import { WorkspaceToolbarService } from '../../services/workspace-toolbar.service';

@Component({
  selector: 'app-crud-task',
  standalone: true,
  imports: [CrudPageComponent],
  template: `
    <section class="crud-task">
      <app-crud-page
        [selectionEnabled]="selectionEnabled()"
        [multipleSelection]="multipleSelection()"
        [initialSelectedEntity]="initialSelectedEntity()"
        [initialSelectedEntities]="initialSelectedEntities()"
        [componentConfiguration]="resolvedComponentConfiguration()"
        [showTableHeader]="toolbarScope() !== 'dialog'" />
    </section>
  `,
  styles: `
    :host,
    .crud-task {
      display: block;
      height: 100%;
      min-height: 0;
    }
  `
})
export class CrudTaskComponent implements OnDestroy {
  static getComponentConfigurationJsonExample(): WorkspaceTaskConfiguration | null {
    return {
      chillType: '',
      chillQuery: null,
      viewCode: 'default',
      relationLabel: {
        labelGuid: "",
        primaryDefaultText: "",
        secondaryDefaultText: ""
      },
      defaultValues: {},
      fixedQueryValues: {},
      defaultQueryValues: {},
      relations: []
    };
  }

  readonly chill = inject(ChillService);
  readonly dialog = inject(WorkspaceDialogService, { optional: true });
  readonly toolbar = inject(WorkspaceToolbarService);
  readonly selectionEnabled = input(false);
  readonly multipleSelection = input(false);
  readonly initialSelectedEntity = input<ChillEntity | null>(null);
  readonly initialSelectedEntities = input<ChillEntity[]>([]);
  readonly componentConfiguration = input<WorkspaceTaskConfiguration | null>(null);
  readonly taskTitle = input('');
  readonly taskDescription = input('');
  readonly toolbarScope = input('workspace');
  private readonly page = viewChild(CrudPageComponent);

  resolvedComponentConfiguration(): CrudPageComponentConfiguration | null {
    const configuration = this.componentConfiguration();
    if (!configuration) {
      return null;
    }

    return configuration as unknown as CrudPageComponentConfiguration;
  }

  constructor() {
    effect(() => {
      const page = this.page();
      const toolbarScope = this.toolbarScope();
      if (!page) {
        this.toolbar.clearButtons(toolbarScope);
        return;
      }

      this.toolbar.setButtons([
        {
          id: 'crud-search',
          labelGuid: 'D513421E-1C00-425E-A89B-E736A440474F',
          primaryDefaultText: 'Search',
          secondaryDefaultText: 'Cerca',
          ariaLabel: this.chill.T('44972777-6760-4F48-BE39-B504E4467150', 'Search', 'Cerca'),
          icon: 'search',
          iconClass: 'material-symbol-icon',
          action: () => page.openSearchDialog(),
          disabled: !page.canOpenSearchDialog()
        },
        {
          id: 'crud-add',
          labelGuid: '23A5536E-8A94-4469-977C-D3BB57E5E621',
          primaryDefaultText: 'Add',
          secondaryDefaultText: 'Aggiungi',
          ariaLabel: this.chill.T('23A5536E-8A94-4469-977C-D3BB57E5E621', 'Add', 'Aggiungi'),
          icon: 'add',
          iconClass: 'material-symbol-icon',
          action: () => page.add(),
          disabled: !page.canAddEntity() || page.isSaving()
        },
        {
          id: 'crud-save-draft',
          labelGuid: 'B8076F7C-34A3-4C28-B4FC-F7D673C0D088',
          primaryDefaultText: 'Save',
          secondaryDefaultText: 'Salva',
          ariaLabel: this.chill.T('B8076F7C-34A3-4C28-B4FC-F7D673C0D088', 'Save', 'Salva'),
          icon: 'save',
          iconClass: 'material-symbol-icon',
          action: () => void page.savePendingEntities(),
          disabled: !page.hasPendingEntities() || page.isSaving()
        }
      ], toolbarScope);
    });
  }

  submit(): void {
    if (this.selectionEnabled()) {
      this.dialog?.confirm(this.page()?.dialogResult() ?? null);
      return;
    }

    this.dialog?.confirm();
  }

  canDialogSubmit(): boolean {
    return this.selectionEnabled()
      ? (this.page()?.canConfirmSelection() ?? false)
      : true;
  }

  ngOnDestroy(): void {
    this.toolbar.clearButtons(this.toolbarScope());
  }
}
