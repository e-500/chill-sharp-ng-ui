# Chill Form Component Usage Documentation

## Overview

The `ChillFormComponent` is a dynamic, schema-driven Angular form component designed to handle both entity editing and query building scenarios. It automatically generates form fields based on a provided `ChillSchema`, supports custom layouts, server-side validation, autocomplete functionality, and integrates with workspace services for layout editing and dialog management.

Key features include:
- Dynamic form generation from schema
- Support for entity and query modes
- Customizable grid-based layout with drag-and-drop editing
- Real-time server validation and autocomplete
- Integration with workspace layout and dialog services

## Basic Usage

### Standalone Component Import

Since this is a standalone component, import it directly in your component:

```typescript
import { ChillFormComponent } from '../lib/chill-form.component';
```

Add it to your component's `imports` array:

```typescript
@Component({
  // ... other metadata
  imports: [ChillFormComponent, /* other imports */],
})
export class MyComponent {
  // component logic
}
```

### Template Usage

```html
<app-chill-form
  [schema]="formSchema"
  [entity]="entityData"
  (formSubmit)="handleSubmit($event)">
</app-chill-form>
```

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `schema` | `ChillSchema \| null` | `null` | The schema that defines the form structure, properties, and validation rules. |
| `entity` | `ChillEntity \| null` | `null` | The entity data to populate the form in edit mode. Mutually exclusive with `query`. |
| `query` | `ChillQuery \| null` | `null` | The query data to populate the form in query mode. Mutually exclusive with `entity`. |
| `submitLabel` | `string` | Localized 'Submit' | The label text for the submit button. |
| `submitLabelGuid` | `string \| null` | `null` | GUID for localized submit label. |
| `submitPrimaryDefaultText` | `string \| null` | `null` | Default text for primary submit action. |
| `submitSecondaryDefaultText` | `string \| null` | `null` | Default text for secondary submit action. |
| `renderSubmitInsideForm` | `boolean` | `true` | Whether to render the submit button inside the form. |
| `onSubmit` | `((event: ChillFormSubmitEvent) => void) \| null` | `null` | Callback function called on form submission. |
| `closeDialogOnSubmit` | `boolean` | `false` | Whether to close the dialog after successful submission. |
| `submitError` | `string \| (() => string) \| null` | `null` | Error message to display on submit failure. |
| `dismissSubmitError` | `(() => void) \| null` | `null` | Callback to dismiss the submit error. |

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| `formSubmit` | `ChillFormSubmitEvent` | Emitted when the form is submitted successfully. Contains the form data as either an entity or query payload. |

## Form Modes

The component operates in two modes based on the inputs:

### Entity Mode
When `entity` is provided (and `query` is null), the form operates in entity editing mode:
- Populates form fields with entity data
- Validates against entity schema
- Submits entity payload

### Query Mode
When `query` is provided (and `entity` is null), the form operates in query building mode:
- Populates form fields with query data
- Validates against query schema
- Submits query payload

## Layout Customization

The component supports custom grid layouts that can be edited when layout editing is enabled:

### Layout Editing
- Enable layout editing through the `WorkspaceLayoutService`
- Drag and drop fields to reorder
- Adjust column spans
- Add empty cells for spacing
- Save layouts to schema metadata

### Layout Configuration
- Default 2-column layout
- Configurable column count (1-6)
- Properties automatically added if not in custom layout

## Validation

### Client-Side Validation
- Built-in Angular reactive forms validation
- Property-level validity tracking
- Form submission blocked on invalid state

### Server-Side Validation
- Asynchronous validation for entity mode in dialogs
- Real-time field validation with debouncing
- Error display for field-specific and generic errors

### Autocomplete
- Automatic field population based on server responses
- Triggered on form changes and field blur
- Debounced to prevent excessive requests

## Methods

### Public Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `submit()` | None | Manually trigger form submission if conditions are met. |
| `toggleEditMode()` | None | Toggle between view and layout edit modes. |
| `updateFields(value: Record<string, JsonValue>)` | `value` - Object with field names and values | Update multiple form fields programmatically. |
| `updatePropertyValidity(propertyName: string, isValid: boolean)` | `propertyName`, `isValid` | Update validity status for a specific property. |
| `clearSubmitError()` | None | Clear the current submit error message. |

### Layout Methods (Edit Mode)

| Method | Parameters | Description |
|--------|------------|-------------|
| `updateColumnCount(value: number \| string)` | `value` - New column count | Change the number of layout columns. |
| `addEmptyCell()` | None | Add an empty cell to the layout. |
| `increaseSpan(itemId: string)` | `itemId` - Layout item ID | Increase the span of a layout item. |
| `decreaseSpan(itemId: string)` | `itemId` - Layout item ID | Decrease the span of a layout item. |
| `resetLayout()` | None | Reset layout to default property order. |

### Drag and Drop Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `beginDrag(itemId: string)` | `itemId` - Item being dragged | Start dragging a layout item. |
| `allowDrop(event: DragEvent)` | `event` - Drag event | Allow drop operation. |
| `dropProperty(targetItemId: string)` | `targetItemId` - Drop target | Handle dropping a property onto another item. |
| `endDrag()` | None | End the current drag operation. |

## Events and Callbacks

### Form Submission
Handle form submission through the `formSubmit` output:

```typescript
handleSubmit(event: ChillFormSubmitEvent): void {
  if (event.kind === 'entity') {
    // Handle entity submission
    console.log('Entity:', event.value);
  } else {
    // Handle query submission
    console.log('Query:', event.value);
  }
}
```

### Property Changes
The component integrates with `ChillPolymorphicInputComponent` for individual field changes:

```html
<app-chill-form
  [schema]="schema"
  [entity]="entity"
  (formSubmit)="onSubmit($event)"
  (propertyBlur)="onPropertyBlur($event)">
</app-chill-form>
```

## Dependencies

The component requires the following services to be available:
- `ChillService` - Core Chill functionality
- `WorkspaceLayoutService` - Layout editing capabilities
- `WorkspaceDialogService` (optional) - Dialog integration

## Styling

The component uses SCSS for styling. Key CSS classes:
- `.chill-form` - Main form container
- `.form-grid` - Grid layout container
- `.form-item` - Individual form item
- `.submit-section` - Submit button area

Customize appearance by overriding these classes in your global styles.

## Error Handling

The component handles various error scenarios:
- Schema validation errors
- Server validation failures
- Layout save errors
- Autocomplete request failures

Errors are displayed through:
- Field-specific error messages
- Generic validation errors
- Submit error notifications

## Best Practices

1. **Always provide a schema**: The component requires a valid `ChillSchema` to function.
2. **Use appropriate mode**: Choose between entity and query mode based on your use case.
3. **Handle submission**: Always listen to the `formSubmit` output for processing.
4. **Consider dialog integration**: Use `closeDialogOnSubmit` when used in dialogs.
5. **Enable layout editing selectively**: Only enable layout editing when appropriate for the user.
6. **Validate inputs**: Ensure schema and data consistency before passing to the component.

## Example Implementation

```typescript
import { Component, inject } from '@angular/core';
import { ChillFormComponent } from '../lib/chill-form.component';
import { ChillService } from '../services/chill.service';
import type { ChillSchema, ChillEntity, ChillFormSubmitEvent } from '../models/chill-schema.models';

@Component({
  selector: 'app-user-form',
  standalone: true,
  imports: [ChillFormComponent],
  template: `
    <app-chill-form
      [schema]="userSchema"
      [entity]="userEntity"
      submitLabel="Save User"
      (formSubmit)="saveUser($event)">
    </app-chill-form>
  `
})
export class UserFormComponent {
  private chill = inject(ChillService);
  
  userSchema: ChillSchema | null = null;
  userEntity: ChillEntity | null = null;

  ngOnInit() {
    // Load schema and entity data
    this.loadUserForm();
  }

  private async loadUserForm() {
    // Implementation to load schema and entity
  }

  saveUser(event: ChillFormSubmitEvent) {
    if (event.kind === 'entity') {
      // Save the entity
      console.log('Saving user:', event.value);
    }
  }
}
```