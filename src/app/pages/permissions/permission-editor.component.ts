import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChillI18nLabelComponent } from '../../lib/chill-i18n-label.component';
import { ChillI18nButtonLabelComponent } from '../../lib/chill-i18n-button-label.component';
import { NoticeTransitionDirective } from '../../lib/notice-transition.directive';
import type { EditableAuthPermissionRule } from '../../models/chill-auth.models';
import { PermissionAction, PermissionEffect, PermissionScope } from '../../models/chill-auth.models';
import { ChillService } from '../../services/chill.service';

export interface PermissionEditorRow extends EditableAuthPermissionRule {
  localId: string;
}

const ALL_PROPERTIES_VALUE = '__all__';

@Component({
  selector: 'app-permission-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillI18nLabelComponent, ChillI18nButtonLabelComponent, NoticeTransitionDirective],
  templateUrl: './permission-editor.component.html',
  styleUrl: './permission-editor.component.scss'
})
export class PermissionEditorComponent {
  readonly chill = inject(ChillService);

  readonly rows = input<PermissionEditorRow[]>([]);
  readonly rowsChange = output<PermissionEditorRow[]>();

  readonly lookupErrorMessage = signal('');
  readonly moduleOptions = signal<string[]>([]);
  readonly entityOptionsByKey = signal<Record<string, string[]>>({});
  readonly propertyOptionsByKey = signal<Record<string, string[]>>({});
  readonly editingRowIds = signal<string[]>([]);

  readonly permissionEffectOptions = [
    { value: PermissionEffect.Allow, label: 'Allow' },
    { value: PermissionEffect.Deny, label: 'Deny' }
  ];

  readonly permissionActionOptions = [
    { value: PermissionAction.FullControl, label: 'FullControl' },
    { value: PermissionAction.Query, label: 'Query' },
    { value: PermissionAction.Create, label: 'Create' },
    { value: PermissionAction.Update, label: 'Update' },
    { value: PermissionAction.Delete, label: 'Delete' },
    { value: PermissionAction.See, label: 'See' },
    { value: PermissionAction.Modify, label: 'Modify' }
  ];

  readonly permissionScopeOptions = [
    { value: PermissionScope.Module, label: 'Module' },
    { value: PermissionScope.Entity, label: 'Entity' },
    { value: PermissionScope.Property, label: 'Property' }
  ];

  constructor() {
    this.loadModuleOptions();

    effect(() => {
      const rows = this.rows();
      this.ensureOptionsForRows(rows);
      this.syncEditingRows(rows);
    });
  }

  addPermissionRule(): void {
    const localId = `new-${crypto.randomUUID()}`;
    this.editingRowIds.update((ids) => [...ids, localId]);
    this.rowsChange.emit([
      ...this.rows(),
      {
        localId,
        guid: '',
        effect: PermissionEffect.Allow,
        action: PermissionAction.Query,
        scope: PermissionScope.Module,
        module: '',
        entityName: '',
        propertyName: '',
        appliesToAllProperties: false,
        description: ''
      }
    ]);
  }

  startEditingRow(rowId: string): void {
    this.editingRowIds.update((ids) => ids.includes(rowId) ? ids : [...ids, rowId]);
  }

  stopEditingRow(rowId: string): void {
    this.editingRowIds.update((ids) => ids.filter((id) => id !== rowId));
  }

  isEditingRow(rowId: string): boolean {
    return this.editingRowIds().includes(rowId);
  }

  updatePermissionRow(rowId: string, key: keyof PermissionEditorRow, value: PermissionEditorRow[keyof PermissionEditorRow]): void {
    this.rowsChange.emit(this.rows().map((row) => {
      if (row.localId !== rowId) {
        return row;
      }

      const updatedRow = { ...row, [key]: value };
      if (key === 'module') {
        updatedRow.entityName = '';
        updatedRow.propertyName = '';
        updatedRow.appliesToAllProperties = false;
        this.ensureEntityOptions(updatedRow.module, updatedRow.action);
      } else if (key === 'action') {
        updatedRow.entityName = '';
        updatedRow.propertyName = '';
        updatedRow.appliesToAllProperties = false;
        this.ensureEntityOptions(updatedRow.module, updatedRow.action);
      } else if (key === 'entityName') {
        updatedRow.propertyName = '';
        updatedRow.appliesToAllProperties = false;
        this.ensurePropertyOptions(updatedRow.module, updatedRow.action, updatedRow.entityName);
      } else if (key === 'scope' && value === PermissionScope.Module) {
        updatedRow.entityName = '';
        updatedRow.propertyName = '';
        updatedRow.appliesToAllProperties = false;
      } else if (key === 'scope' && value === PermissionScope.Entity) {
        updatedRow.propertyName = '';
        updatedRow.appliesToAllProperties = false;
      } else if (key === 'appliesToAllProperties') {
        updatedRow.appliesToAllProperties = !!value;
        updatedRow.propertyName = updatedRow.appliesToAllProperties ? '' : updatedRow.propertyName;
      }

      return updatedRow;
    }));
  }

  updatePropertySelection(rowId: string, value: string): void {
    this.rowsChange.emit(this.rows().map((row) => {
      if (row.localId !== rowId) {
        return row;
      }

      if (value === ALL_PROPERTIES_VALUE) {
        return {
          ...row,
          propertyName: '',
          appliesToAllProperties: true
        };
      }

      return {
        ...row,
        propertyName: value,
        appliesToAllProperties: false
      };
    }));
  }

  removePermissionRow(rowId: string): void {
    this.stopEditingRow(rowId);
    this.rowsChange.emit(this.rows().filter((row) => row.localId !== rowId));
  }

  effectLabel(value: number): string {
    return this.permissionEffectOptions.find((option) => option.value === value)?.label ?? String(value);
  }

  actionLabel(value: number): string {
    return this.permissionActionOptions.find((option) => option.value === value)?.label ?? String(value);
  }

  scopeLabel(value: number): string {
    return this.permissionScopeOptions.find((option) => option.value === value)?.label ?? String(value);
  }

  targetLabel(row: PermissionEditorRow): string {
    if (row.scope === PermissionScope.Module) {
      return row.module?.trim() || this.chill.T('DB687669-CA05-4786-83C7-E5537D38FBCB', 'Any module', 'Qualsiasi modulo');
    }

    if (row.scope === PermissionScope.Entity) {
      return row.entityName?.trim() || this.chill.T('A69C0B93-F1E2-41BE-8586-1493B10A4033', 'Any entity', 'Qualsiasi entita');
    }

    if (row.appliesToAllProperties) {
      return `${row.entityName?.trim() || this.chill.T('4B45CB93-F918-4892-A208-9A46282DEBBC', 'Entity', 'Entita')}.*`;
    }

    return row.propertyName?.trim()
      || this.chill.T('16A9A1A4-B1B6-49D7-AE2C-927E96D05172', 'Any property', 'Qualsiasi proprieta');
  }

  descriptionLabel(row: PermissionEditorRow): string {
    return row.description?.trim()
      || this.chill.T('57D5BF09-012A-43D4-84BF-2BA33DDECA31', 'No description', 'Nessuna descrizione');
  }

  entityOptionsFor(row: PermissionEditorRow): string[] {
    return this.entityOptionsByKey()[this.entityOptionsKey(row.module, row.action)] ?? [];
  }

  propertyOptionsFor(row: PermissionEditorRow): string[] {
    return this.propertyOptionsByKey()[this.propertyOptionsKey(row.module, row.action, row.entityName)] ?? [];
  }

  propertySelectValueFor(row: PermissionEditorRow): string {
    return row.appliesToAllProperties ? ALL_PROPERTIES_VALUE : (row.propertyName ?? '');
  }

  private loadModuleOptions(): void {
    this.chill.getModuleList().subscribe({
      next: (modules) => {
        this.moduleOptions.set(modules);
      },
      error: (error: unknown) => {
        this.lookupErrorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private ensureOptionsForRows(rows: PermissionEditorRow[]): void {
    rows.forEach((row) => {
      this.ensureEntityOptions(row.module, row.action);
      this.ensurePropertyOptions(row.module, row.action, row.entityName);
    });
  }

  private syncEditingRows(rows: PermissionEditorRow[]): void {
    const activeIds = new Set(rows.map((row) => row.localId));
    this.editingRowIds.update((ids) => ids.filter((id) => activeIds.has(id)));
  }

  private ensureEntityOptions(module: string | undefined, action: PermissionAction): void {
    const normalizedModule = module?.trim() ?? '';
    if (!normalizedModule) {
      return;
    }

    const key = this.entityOptionsKey(normalizedModule, action);
    if (this.entityOptionsByKey()[key]) {
      return;
    }

    const source = action === PermissionAction.Query
      ? this.chill.getQueryList(normalizedModule)
      : this.chill.getEntityList(normalizedModule);

    source.subscribe({
      next: (entities) => {
        this.entityOptionsByKey.update((current) => ({
          ...current,
          [key]: entities
        }));
      },
      error: (error: unknown) => {
        this.lookupErrorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private ensurePropertyOptions(module: string | undefined, action: PermissionAction, entityName: string | undefined): void {
    const normalizedModule = module?.trim() ?? '';
    const normalizedEntityName = entityName?.trim() ?? '';
    if (!normalizedModule || !normalizedEntityName) {
      return;
    }

    const key = this.propertyOptionsKey(normalizedModule, action, normalizedEntityName);
    if (this.propertyOptionsByKey()[key]) {
      return;
    }

    this.chill.getPropertyList(normalizedEntityName).subscribe({
      next: (properties) => {
        this.propertyOptionsByKey.update((current) => ({
          ...current,
          [key]: properties
        }));
      },
      error: (error: unknown) => {
        this.lookupErrorMessage.set(this.chill.formatError(error));
      }
    });
  }

  private entityOptionsKey(module: string | undefined, action: PermissionAction): string {
    return `${action}|${module?.trim() ?? ''}`;
  }

  private propertyOptionsKey(module: string | undefined, action: PermissionAction, entityName: string | undefined): string {
    return `${action}|${module?.trim() ?? ''}|${entityName?.trim() ?? ''}`;
  }
}
