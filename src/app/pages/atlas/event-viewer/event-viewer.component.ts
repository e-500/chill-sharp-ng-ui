import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import { ChillI18nLabelComponent } from '../../../lib/chill-i18n-label.component';
import { ChillFormComponent } from '../../../lib/chill-form.component';
import { ChillTableComponent } from '../../../lib/chill-table.component';
import type { ChillEntity, ChillFormSubmitEvent, ChillQuery, ChillSchema, ChillSchemaListItem } from '../../../models/chill-schema.models';
import { ChillService } from '../../../services/chill.service';

const EVENT_QUERY_NAME = 'EventQuery';
const EVENT_QUERY_TYPE = 'Model.Query.EventQuery';
const DEFAULT_VIEW_CODE = 'default';

@Component({
  selector: 'app-event-viewer',
  standalone: true,
  imports: [CommonModule, ChillFormComponent, ChillTableComponent, ChillI18nLabelComponent],
  templateUrl: './event-viewer.component.html',
  styleUrl: './event-viewer.component.scss'
})
export class EventViewerComponent implements OnInit {
  readonly chill = inject(ChillService);

  readonly isLoadingSchema = signal(true);
  readonly isSearching = signal(false);
  readonly errorMessage = signal('');
  readonly querySchema = signal<ChillSchema | null>(null);
  readonly resultSchema = signal<ChillSchema | null>(null);
  readonly queryModel = signal<ChillQuery | null>(null);
  readonly results = signal<ChillEntity[]>([]);

  ngOnInit(): void {
    this.loadSchemas();
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

  private loadSchemas(): void {
    this.isLoadingSchema.set(true);
    this.errorMessage.set('');

    this.chill.getSchemaList().subscribe({
      next: (schemaList) => {
        const queryType = this.resolveEventQueryType(schemaList);
        this.loadQuerySchema(queryType);
      },
      error: (error: unknown) => {
        console.warn('[EventViewer] getSchemaList() failed, falling back to direct schema lookup.', error);
        this.loadQuerySchema(EVENT_QUERY_TYPE);
      }
    });
  }

  private loadQuerySchema(chillType: string): void {
    this.chill.getSchema(chillType, DEFAULT_VIEW_CODE).subscribe({
      next: (schema) => {
        if (!schema) {
          this.querySchema.set(null);
          this.resultSchema.set(null);
          this.queryModel.set(null);
          this.results.set([]);
          this.errorMessage.set(this.chill.T('12207086-0C1B-41C0-9888-72A3D6052B1E', 'The EventQuery schema is unavailable.', 'Lo schema EventQuery non è disponibile.'));
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
      this.errorMessage.set(this.chill.T('76D0FD2B-E98B-4A9F-A2C7-2053D2E42976', 'The query schema does not define QueryRelatedChillType.', 'Lo schema della query non definisce QueryRelatedChillType.'));
      this.isLoadingSchema.set(false);
      return;
    }

    this.chill.getSchema(relatedChillType, DEFAULT_VIEW_CODE).subscribe({
      next: (schema) => {
        this.resultSchema.set(schema);
        if (!schema) {
          this.errorMessage.set(this.chill.T('B4CA3038-C0E0-4694-B835-4889D04CE7C4', 'The result schema is unavailable.', 'Lo schema dei risultati non è disponibile.'));
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

  private resolveEventQueryType(schemaList: ChillSchemaListItem[]): string {
    const normalizedTargetName = EVENT_QUERY_NAME.toLowerCase();
    const matchedSchema = schemaList.find((item) => item.name?.trim().toLowerCase() === normalizedTargetName)
      ?? schemaList.find((item) => item.chillType?.trim() === EVENT_QUERY_TYPE)
      ?? schemaList.find((item) => item.chillType?.trim().toLowerCase().endsWith(`.${normalizedTargetName}`));

    return matchedSchema?.chillType?.trim() || EVENT_QUERY_TYPE;
  }

  private createQueryModel(schema: ChillSchema): ChillQuery {
    return this.normalizeQuery({
      chillType: schema.chillType?.trim() || EVENT_QUERY_TYPE,
      properties: {}
    });
  }

  private normalizeQuery(query: ChillQuery): ChillQuery {
    const resultSchema = this.resultSchema();
    return {
      ...query,
      chillType: query.chillType?.trim() || this.querySchema()?.chillType?.trim() || EVENT_QUERY_TYPE,
      resultProperties: resultSchema?.properties?.map((property) => ({ PropertyName: property.name })) ?? []
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
}
