import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import { ChillFormComponent } from '../../lib/chill-form.component';
import { ChillTableComponent } from '../../lib/chill-table.component';
import type { ChillEntity, ChillFormSubmitEvent, ChillQuery, ChillSchema, ChillSchemaListItem } from '../../models/chill-schema.models';
import { ChillService } from '../../services/chill.service';

const DEFAULT_VIEW_CODE = 'default';

@Component({
  selector: 'app-crud-page',
  standalone: true,
  imports: [CommonModule, FormsModule, ChillFormComponent, ChillTableComponent],
  templateUrl: './crud-page.component.html',
  styleUrl: './crud-page.component.scss'
})
export class CrudPageComponent implements OnInit {
  readonly chill = inject(ChillService);

  readonly isLoadingSchemaList = signal(true);
  readonly isLoadingSchema = signal(false);
  readonly isSearching = signal(false);
  readonly errorMessage = signal('');
  readonly querySchemas = signal<ChillSchemaListItem[]>([]);
  readonly selectedQueryType = signal('');
  readonly querySchema = signal<ChillSchema | null>(null);
  readonly resultSchema = signal<ChillSchema | null>(null);
  readonly queryModel = signal<ChillQuery | null>(null);
  readonly results = signal<ChillEntity[]>([]);

  ngOnInit(): void {
    this.loadQuerySchemas();
  }

  selectQuerySchema(chillType: string): void {
    const normalizedType = chillType.trim();
    this.selectedQueryType.set(normalizedType);
    this.errorMessage.set('');
    this.results.set([]);

    if (!normalizedType) {
      this.querySchema.set(null);
      this.resultSchema.set(null);
      this.queryModel.set(null);
      return;
    }

    this.loadSelectedSchema(normalizedType);
  }

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
        this.results.set(this.extractEntities(response));
        this.isSearching.set(false);
      },
      error: (error: unknown) => {
        this.results.set([]);
        this.errorMessage.set(this.chill.formatError(error));
        this.isSearching.set(false);
      }
    });
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

        this.selectQuerySchema(querySchemas[0].chillType?.trim() ?? '');
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

    this.chill.getSchema(chillType, DEFAULT_VIEW_CODE).subscribe({
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
        void this.loadResultSchema(schema.queryRelatedChillType?.trim() ?? '');
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

  private async loadResultSchema(relatedChillType: string): Promise<void> {
    if (!relatedChillType) {
      this.resultSchema.set(null);
      this.errorMessage.set(this.chill.T('C187D4C0-DB14-476E-9A40-F6D086C2D7A5', 'The selected query schema does not define QueryRelatedChillType.', 'Lo schema di query selezionato non definisce QueryRelatedChillType.'));
      this.isLoadingSchema.set(false);
      return;
    }

    this.chill.getSchema(relatedChillType, DEFAULT_VIEW_CODE).subscribe({
      next: (schema) => {
        this.resultSchema.set(schema);
        if (!schema) {
          this.errorMessage.set(this.chill.T('A6A6949E-F0D4-42F5-A8AE-E15B1B174084', 'The result schema is unavailable.', 'Lo schema dei risultati non è disponibile.'));
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

  private createQueryModel(schema: ChillSchema): ChillQuery {
    return this.normalizeQuery({
      chillType: schema.chillType?.trim() || this.selectedQueryType(),
      properties: {}
    });
  }

  private normalizeQuery(query: ChillQuery): ChillQuery {
    const resultSchema = this.resultSchema();
    return {
      ...query,
      chillType: query.chillType?.trim() || this.querySchema()?.chillType?.trim() || this.selectedQueryType(),
      resultProperties: resultSchema?.properties?.map((property) => ({ Name: property.name })) ?? []
    };
  }

  private extractEntities(response: JsonObject): ChillEntity[] {
    const candidates = [
      response,
      response['Results'],
      response['Entities'],
      response['Items'],
      response['Value'],
      response['Data']
    ];

    for (const candidate of candidates) {
      const entities = this.toEntityArray(candidate);
      if (entities.length > 0) {
        return entities;
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
    return item.name?.trim() || item.chillType?.trim() || '';
  }
}
