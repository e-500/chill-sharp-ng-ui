# Chill Polymorphic Input Component Usage Documentation

## Overview

The `ChillPolymorphicInputComponent` is an Angular component designed to dynamically render form inputs based on a provided schema. It supports various property types (e.g., integers, decimals, strings, dates, lookups) and handles validation, lookups, and user interactions automatically. This component is ideal for building flexible forms where the input fields are determined at runtime by a schema definition.

The component integrates with Angular Reactive Forms and uses signals for reactive state management. It emits changes for values, validity, and blur events, making it easy to integrate into larger form systems.

## Selector

```html
<app-chill-polymorphic-input></app-chill-polymorphic-input>
```

## Inputs

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `form` | `FormGroup<Record<string, FormControl<JsonValue>>> \| null` | Yes | `null` | The Angular Reactive Form group containing the form controls for the properties. Each property name should correspond to a control in this group. |
| `schema` | `ChillSchema \| null` | Yes | `null` | The schema object defining the properties to render. This includes property types, metadata, and other configuration details. |
| `propertyNames` | `string[] \| null` | No | `null` | An optional array of property names to include. If provided, only these properties will be rendered. If omitted, all properties from the schema are included. |
| `externalErrors` | `Record<string, string> \| null` | No | `null` | A record of external validation errors keyed by property name. These are merged with internal validation errors. |
| `showLabels` | `boolean` | No | `true` | Whether to display labels for the input fields. If `false`, placeholders are used instead. |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| `valueChange` | `EventEmitter<Record<string, JsonValue>>` | Emitted whenever the values of any property change. The payload is a record of property names to their current values. |
| `validityChange` | `EventEmitter<boolean>` | Emitted when the overall validity of the form changes. `true` if all fields are valid, `false` otherwise. |
| `fieldBlur` | `EventEmitter<Record<string, JsonValue>>` | Emitted when a field loses focus. The payload includes the property name and its current value. |

## Supported Property Types

The component automatically adapts its rendering and validation based on the `propertyType` from the schema. Supported types include:

- **Boolean**: Renders as a checkbox.
- **Integer**: Renders as a number input with integer validation.
- **Decimal**: Renders as a number input with decimal validation.
- **String/Text**: Renders as a text input or textarea (based on metadata).
- **Date**: Renders as a date input with date validation.
- **Time**: Renders as a time input with time validation.
- **DateTime**: Renders as a datetime input with datetime validation.
- **Duration**: Renders as a text input with duration validation (ISO 8601 format).
- **Guid**: Renders as a text input with GUID validation.
- **ChillEntity/ChillQuery**: Renders as a lookup input with search functionality.
- **ChillEntityCollection**: Renders as a multi-select lookup input.

Unknown property types are skipped.

## Validation

Validation is performed automatically based on the property type and metadata:

- **Required fields**: Enforced if `metadata.required` is set to `'true'`, `'1'`, or `'required'`.
- **Numeric ranges**: Min/max values from `metadata.min` and `metadata.max`.
- **String constraints**: Min/max length from `metadata.minLength` and `metadata.maxLength`, and regex patterns from `metadata.pattern`.
- **Custom formats**: For text fields, `metadata.multiline` can force a textarea.

External errors can be passed via the `externalErrors` input and are displayed alongside internal errors.

### Error Resolution Order

The component builds the final visible field error from multiple sources:

1. Local type/metadata validation stored in the component state
2. Angular control async errors under the `serverValidation` key
3. External errors passed through `externalErrors`

External errors are normalized against schema property names before display, so case differences in server responses do not prevent the message from appearing on the correct field.

## Lookup Functionality

For `ChillEntity`, `ChillQuery`, and `ChillEntityCollection` types:

- Provides a search input that queries the backend for matching entities.
- Supports single or multiple selection based on the type.
- Displays results in a dropdown and allows opening a dialog for advanced selection.
- Automatically populates labels and GUIDs from the selected entities.

## Blur And Value Normalization

- Text-like inputs call `normalizeTextOnBlur(...)` before emitting `fieldBlur`.
- Numeric, date, time, datetime, and duration values are normalized into the storage format expected by the form.
- Lookup blur emits the current value and clears the visible result list after a short delay so click selection still works.
- The parent form can use `fieldBlur` to trigger autocomplete or clear stored server-side validation errors for the blurred field.

## Integration With ChillFormComponent

When hosted by `ChillFormComponent`, this component participates in the server-validation loop:

- `externalErrors` receives the form-level `serverFieldErrors`.
- `validationMessage(...)` returns the merged field message shown in the UI.
- `validityChange` contributes to the form-level `propertyValidity` map.
- `fieldBlur` lets the parent reapply normalized values and trigger autocomplete.

This integration is important for dialog editing, because submit remains blocked in the parent form until field-level server errors are cleared.

## Usage Examples

### Basic Setup

```typescript
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, FormControl } from '@angular/forms';
import type { ChillSchema } from '../models/chill-schema.models';

@Component({
  selector: 'app-example',
  template: `
    <form [formGroup]="myForm">
      <app-chill-polymorphic-input
        [form]="myForm"
        [schema]="schema"
        (valueChange)="onValueChange($event)"
        (validityChange)="onValidityChange($event)">
      </app-chill-polymorphic-input>
    </form>
  `
})
export class ExampleComponent {
  myForm: FormGroup = this.fb.group({
    name: new FormControl(''),
    age: new FormControl(0),
    isActive: new FormControl(false)
  });

  schema: ChillSchema = {
    properties: [
      { name: 'name', propertyType: 'String', displayName: 'Name' },
      { name: 'age', propertyType: 'Integer', displayName: 'Age', metadata: { min: 0, max: 120 } },
      { name: 'isActive', propertyType: 'Boolean', displayName: 'Active' }
    ]
  };

  constructor(private fb: FormBuilder) {}

  onValueChange(values: Record<string, JsonValue>) {
    console.log('Values changed:', values);
  }

  onValidityChange(isValid: boolean) {
    console.log('Form valid:', isValid);
  }
}
```

### With Lookups

```typescript
// Assuming a schema with a lookup property
schema: ChillSchema = {
  properties: [
    {
      name: 'user',
      propertyType: 'ChillEntity',
      chillType: 'User',
      displayName: 'User'
    }
  ]
};

// The component will render a search input for selecting a user entity.
```

### Handling External Errors

```typescript
externalErrors = { name: 'Name is required' };

// Pass to the component
<app-chill-polymorphic-input [externalErrors]="externalErrors" ...></app-chill-polymorphic-input>
```

## Dependencies

- Angular Core (Reactive Forms, Common Module)
- `chill-sharp-ng-client` for types and services
- `ChillService` for translations, queries, and error formatting
- `WorkspaceDialogService` for lookup dialogs

## Notes

- The component uses Angular signals for reactive updates, ensuring efficient change detection.
- Lookup searches are debounced to avoid excessive API calls.
- For collections, values are arrays of `JsonObject`.
- Ensure the `form` input is properly initialized with controls matching the schema properties.
- The component handles normalization on blur for certain types (e.g., parsing dates).
- `resolvedErrors` merges local validation, async control validation, and externally supplied server field errors.
