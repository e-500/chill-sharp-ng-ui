# Chill Polymorphic Output Component Usage Documentation

## Overview

The `ChillPolymorphicOutputComponent` is an Angular component designed to display the value of a specific property from a `ChillEntity` object, formatted according to its schema-defined type. It automatically handles different data types (e.g., booleans, dates, entities) and provides responsive display options, such as shortening labels when the container is narrow. This component is useful for read-only displays in lists, details views, or reports where data needs to be presented in a user-friendly format.

The component uses Angular signals for reactive updates and integrates with the `ChillService` for translations and formatting.

## Selector

```html
<app-chill-polymorphic-output></app-chill-polymorphic-output>
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `source` | `ChillEntity \| null` | No | `null` | The entity object containing the property values. The component reads the value from this entity's properties. |
| `schema` | `ChillSchema \| null` | No | `null` | The schema object defining the property types and metadata. Used to determine how to format the value. |
| `propertyName` | `string` | Yes | N/A | The name of the property to display. This must match a property in the schema and source entity. |

## Outputs

This component does not emit any outputs.

## Supported Property Types

The component formats values based on the `propertyType` from the schema. Supported types include:

- **Boolean**: Displays as "Yes" or "No" (translated).
- **Date**: Formats as a localized date string.
- **DateTime**: Formats as a localized date and time string.
- **ChillEntity/ChillQuery**: Displays the entity's label (e.g., `Label`, `DisplayName`, or `Name`). Uses short labels if the container is narrow (< 140px).
- **Other types** (e.g., String, Integer): Displays the raw value as a string.
- **Arrays**: Joins multiple values with commas.

If the value is an array, each item is formatted individually and joined.

## Usage Examples

### Basic Display

```typescript
import { Component } from '@angular/core';
import type { ChillEntity, ChillSchema } from '../models/chill-schema.models';

@Component({
  selector: 'app-example',
  template: `
    <app-chill-polymorphic-output
      [source]="entity"
      [schema]="schema"
      propertyName="name">
    </app-chill-polymorphic-output>
  `
})
export class ExampleComponent {
  entity: ChillEntity = {
    properties: {
      name: 'John Doe',
      age: 30,
      isActive: true
    }
  };

  schema: ChillSchema = {
    properties: [
      { name: 'name', propertyType: 'String', displayName: 'Name' },
      { name: 'age', propertyType: 'Integer', displayName: 'Age' },
      { name: 'isActive', propertyType: 'Boolean', displayName: 'Active' }
    ]
  };
}
```

### Displaying a Date

```typescript
// Assuming the entity has a date property
entity: ChillEntity = {
  properties: {
    birthDate: '1990-01-01'
  }
};

schema: ChillSchema = {
  properties: [
    { name: 'birthDate', propertyType: 'Date', displayName: 'Birth Date' }
  ]
};

// Renders as a localized date, e.g., "1/1/1990"
```

### Entity Lookup Display

```typescript
entity: ChillEntity = {
  properties: {
    manager: {
      Guid: '123e4567-e89b-12d3-a456-426614174000',
      Label: 'Jane Smith',
      ShortLabel: 'J. Smith'
    }
  }
};

schema: ChillSchema = {
  properties: [
    { name: 'manager', propertyType: 'ChillEntity', displayName: 'Manager' }
  ]
};

// Displays "Jane Smith" (or "J. Smith" if container is narrow)
```

## Dependencies

- Angular Core (Common Module)
- `chill-sharp-ng-client` for types
- `ChillService` for translations (e.g., "Yes"/"No")

## Notes

- The component uses a `ResizeObserver` to detect container width and prefer short labels for narrow spaces.
- Values are read from `source.properties`, `source[propertyName]`, or `source[toPascalCase(propertyName)]`.
- For objects, it prioritizes `Label` > `ShortLabel` > `DisplayName` > `Name` > `Guid`.
- If no schema is provided, it falls back to basic string conversion.
- The component is standalone and can be used in any Angular template.
