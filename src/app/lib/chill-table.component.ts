import { CommonModule } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillEntity, ChillPropertySchema, ChillSchema } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';

@Component({
  selector: 'app-chill-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chill-table.component.html',
  styleUrl: './chill-table.component.scss'
})
export class ChillTableComponent {
  readonly chill = inject(ChillService);
  readonly schema = input<ChillSchema | null>(null);
  readonly entities = input<ChillEntity[]>([]);

  readonly columns = computed(() => this.schema()?.properties ?? []);

  trackByEntity(index: number, entity: ChillEntity): string {
    return entity.guid ?? entity.label ?? `${index}`;
  }

  cellText(entity: ChillEntity, column: ChillPropertySchema): string {
    const value = this.readPropertyValue(entity, column.name);
    return this.formatValue(value);
  }

  private readPropertyValue(entity: ChillEntity, propertyName: string): JsonValue | undefined {
    const properties = entity.properties;
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    const directValue = entity[propertyName];
    return directValue;
  }

  private formatValue(value: JsonValue | undefined): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      const rendered = value
        .map((item) => this.formatValue(item))
        .filter((item) => item.length > 0);

      return rendered.join(', ');
    }

    return this.formatObjectValue(value);
  }

  private formatObjectValue(value: JsonObject): string {
    const label = this.readObjectText(value, 'Label')
      ?? this.readObjectText(value, 'DisplayName')
      ?? this.readObjectText(value, 'Name')
      ?? this.readObjectText(value, 'Guid');

    if (label) {
      return label;
    }

    return '';
  }

  private readObjectText(value: JsonObject, key: string): string | null {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }

    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return String(candidate);
    }

    return null;
  }
}
