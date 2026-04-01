import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import type { JsonObject, JsonValue } from 'chill-sharp-ng-client';
import type { ChillEntity, ChillPropertySchema, ChillSchema } from '../models/chill-schema.models';
import { ChillService } from '../services/chill.service';

const CHILL_PROPERTY_TYPE = {
  Unknown: 0,
  Guid: 1,
  Integer: 10,
  Decimal: 20,
  Date: 30,
  Time: 40,
  DateTime: 50,
  Duration: 60,
  Boolean: 70,
  String: 80,
  Text: 81,
  ChillEntity: 1000,
  ChillEntityCollection: 1010,
  ChillQuery: 1100
} as const;

@Component({
  selector: 'app-chill-polymorphic-output',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="polymorphic-output" [title]="titleText()">
      {{ displayText() }}
    </span>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .polymorphic-output {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
    }
  `
})
export class ChillPolymorphicOutputComponent implements OnInit, OnDestroy {
  readonly chill = inject(ChillService);
  readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly source = input<ChillEntity | null>(null);
  readonly schema = input<ChillSchema | null>(null);
  readonly propertyName = input.required<string>();
  readonly hostWidth = signal<number | null>(null);

  readonly property = computed<ChillPropertySchema | null>(() =>
    this.schema()?.properties.find((candidate) => candidate.name === this.propertyName()) ?? null
  );
  readonly value = computed(() => this.readPropertyValue(this.source(), this.propertyName()));
  readonly displayText = computed(() => this.formatValue(this.value(), this.property(), false));
  readonly titleText = computed(() => this.formatValue(this.value(), this.property(), true));

  private resizeObserver: ResizeObserver | null = null;

  ngOnInit(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      this.hostWidth.set(entry ? entry.contentRect.width : null);
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private readPropertyValue(source: ChillEntity | null, propertyName: string): JsonValue | undefined {
    if (!source) {
      return undefined;
    }

    const properties = source.properties
      ?? (this.isJsonObject(source['Properties']) ? source['Properties'] : undefined);
    if (properties && propertyName in properties) {
      return properties[propertyName];
    }

    return source[propertyName] ?? source[this.toPascalCase(propertyName)];
  }

  private formatValue(value: JsonValue | undefined, property: ChillPropertySchema | null, preferFullLabel: boolean): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.formatValue(item, property, preferFullLabel))
        .filter((item) => item.length > 0)
        .join(', ');
    }

    const propertyType = property?.propertyType ?? CHILL_PROPERTY_TYPE.Unknown;
    switch (propertyType) {
      case CHILL_PROPERTY_TYPE.Boolean:
        return value === true
          ? this.chill.T('1A29951D-C442-4187-B0AA-F80454DEB09D', 'Yes', 'Si')
          : this.chill.T('8A65EBA6-81BD-4733-87D5-4CFE3F5C2D3F', 'No', 'No');
      case CHILL_PROPERTY_TYPE.Date:
        return this.formatDate(value);
      case CHILL_PROPERTY_TYPE.DateTime:
        return this.formatDateTime(value);
      case CHILL_PROPERTY_TYPE.ChillEntity:
      case CHILL_PROPERTY_TYPE.ChillQuery:
        return this.formatObjectValue(value, preferFullLabel);
      default:
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return String(value);
        }

        return this.formatObjectValue(value, preferFullLabel);
    }
  }

  private formatDate(value: JsonValue): string {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString();
  }

  private formatDateTime(value: JsonValue): string {
    if (typeof value !== 'string' || !value.trim()) {
      return '';
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString();
  }

  private formatObjectValue(value: JsonValue, preferFullLabel: boolean): string {
    if (!this.isJsonObject(value)) {
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
    }

    const label = this.readObjectText(value, ['Label', 'label']);
    const shortLabel = this.readObjectText(value, ['ShortLabel', 'shortLabel']);
    const displayName = this.readObjectText(value, ['DisplayName', 'displayName']);
    const name = this.readObjectText(value, ['Name', 'name']);
    const guid = this.readObjectText(value, ['Guid', 'guid']);
    const shouldUseShortLabel = !preferFullLabel
      && !!shortLabel
      && this.shouldPreferShortLabel();
    const resolvedLabel = shouldUseShortLabel
      ? shortLabel
      : label || shortLabel || displayName || name || guid;

    return resolvedLabel ?? '';
  }

  private toPascalCase(value: string): string {
    return value.length > 0
      ? `${value[0].toUpperCase()}${value.slice(1)}`
      : value;
  }

  private isJsonObject(value: JsonValue | null | undefined): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private readObjectText(value: JsonObject, keys: string[]): string | null {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }

      if (typeof candidate === 'number' || typeof candidate === 'boolean') {
        return String(candidate);
      }
    }

    return null;
  }

  private shouldPreferShortLabel(): boolean {
    const hostWidth = this.hostWidth();
    return hostWidth !== null && hostWidth < 140;
  }
}
