# Chill Table Component Usage Documentation

The `ChillTableComponent` is a powerful, feature-rich table component designed for displaying and interacting with Chill entities in Angular applications. It provides advanced functionality including inline editing, column customization, row selection, and real-time data synchronization.

## Table of Contents

- Overview
- Basic Usage
- Component Inputs
- Component Outputs
- Features
- Examples
- Styling
- Dependencies

## Overview

The Chill Table component renders entities from a Chill schema in a responsive, interactive table format. Key capabilities include:

- **Dynamic Column Management**: Show/hide columns, reorder via drag-and-drop, and customize display names
- **Inline Editing**: Double-click cells to edit values directly in the table
- **Row Selection**: Single or multiple row selection with checkboxes
- **Row Actions**: Configurable action buttons for each row (edit, delete, etc.)
- **Real-time Updates**: Automatic synchronization with server-side entity changes
- **Validation Display**: Visual feedback for validation errors
- **Responsive Design**: Mobile-friendly with horizontal scrolling

## Basic Usage

```html
<app-chill-table
  [schema]="mySchema"
  [entities]="myEntities"
  [enableInlineEditing]="true"
  (cellEditCommit)="handleCellEdit($event)">
</app-chill-table>
```

```typescript
import { ChillTableComponent } from './lib/chill-table.component';

@Component({
  // ...
  imports: [ChillTableComponent]
})
export class MyComponent {
  mySchema = signal<ChillSchema | null>(null);
  myEntities = signal<ChillEntity[]>([]);

  handleCellEdit(event: ChillTableCellEditCommitEvent) {
    // Handle inline cell edits
    console.log('Edited:', event.entity, event.propertyName, event.value);
  }
}
```

## Component Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | `ChillSchema \| null` | Yes | The schema defining the table structure and properties |
| `entities` | `ChillEntity[]` | Yes | Array of entities to display in the table |
| `selectionColumn` | `ChillTableSelectionColumn \| null` | No | Configuration for row selection functionality |
| `rowAction` | `ChillTableRowAction \| null` | No | Single row action configuration |
| `rowActions` | `ChillTableRowAction[] \| null` | No | Multiple row actions configuration |
| `enableInlineEditing` | `boolean` | No | Enables double-click inline editing (default: false) |
| `validationFocus` | `ChillTableValidationFocus \| null` | No | Focus configuration for validation errors |

### Selection Column Configuration

```typescript
interface ChillTableSelectionColumn {
  ariaLabel?: string;
  disabled?: (entity: ChillEntity) => boolean;
  isSelected: (entity: ChillEntity) => boolean;
  toggle: (entity: ChillEntity, selected: boolean) => void;
}
```

### Row Action Configuration

```typescript
interface ChillTableRowAction {
  icon?: string; // Icon name or emoji (defaults to '✎' for edit)
  ariaLabel?: string;
  disabled?: (entity: ChillEntity) => boolean;
  handler: (entity: ChillEntity) => void;
}
```

### Validation Focus Configuration

```typescript
interface ChillTableValidationFocus {
  entityKey: string;
  propertyName: string;
}
```

## Component Outputs

| Output | Type | Description |
|--------|------|-------------|
| `cellEditCommit` | `ChillTableCellEditCommitEvent` | Emitted when an inline cell edit is committed |

### Cell Edit Commit Event

```typescript
interface ChillTableCellEditCommitEvent {
  entity: ChillEntity;
  propertyName: string;
  value: JsonValue;
  dirtyProperties: string[];
}
```

## Features

### Column Layout Customization

When layout editing is enabled via `WorkspaceLayoutService.isLayoutEditingEnabled()`, users can:

- **Show/Hide Columns**: Toggle column visibility with checkboxes
- **Reorder Columns**: Drag and drop column headers to reorder
- **Rename Columns**: Edit display names inline
- **Reveal Hidden Columns**: Dropdown to show hidden columns

Layout changes are persisted to the schema metadata.

### Inline Editing

- Double-click any cell to enter edit mode
- Uses `ChillPolymorphicInputComponent` for appropriate input types
- Press Enter to commit, Escape to cancel
- Focus-out automatically commits changes
- Validation errors are displayed inline

### Row Selection

- Optional checkbox column for row selection
- Supports single or multiple selection modes
- Configurable selection state and toggle handlers

### Row Actions

- Action buttons displayed in a dedicated column
- Multiple actions per row supported
- Icons default to pencil (✎) for edit, trash (🗑) for delete
- Actions can be disabled per entity

### Real-time Updates

- Subscribes to entity change notifications via `ChillService.watchEntityChanges()`
- Automatically refreshes displayed entities when server data changes
- Handles conflicts between local edits and remote updates
- Merges changes while preserving local modifications

### Validation and Error Display

- Field-level validation errors shown inline during editing
- Generic validation errors displayed at the table level
- Visual indicators for pending/dirty/deleted rows
- Automatic focus on first validation error

## Examples

### Complete CRUD Table with Selection

```html
<app-chill-table
  [schema]="resultSchema()"
  [entities]="pagedResults()"
  [selectionColumn]="selectionColumn()"
  [rowActions]="activeRowActions()"
  [enableInlineEditing]="true"
  [validationFocus]="validationFocus()"
  (cellEditCommit)="handleInlineCellEdit($event)">
</app-chill-table>
```

```typescript
readonly rowActions = computed<ChillTableRowAction[]>(() => [
  {
    icon: 'Pencil',
    ariaLabel: 'Edit row',
    disabled: (entity) => this.isSaving() || this.isDeletedEntity(entity),
    handler: (entity) => this.openEntityDialog(entity)
  },
  {
    icon: 'Bin',
    ariaLabel: 'Delete row',
    disabled: (entity) => this.isSaving() || this.isDeletedEntity(entity),
    handler: (entity) => this.markEntityDeleted(entity)
  }
]);

readonly selectionColumn = computed<ChillTableSelectionColumn | null>(() => 
  this.selectionEnabled() ? {
    ariaLabel: 'Select row',
    isSelected: (entity) => this.isEntitySelected(entity),
    toggle: (entity, selected) => this.toggleSelectedEntity(entity, selected),
    disabled: () => this.isSaving()
  } : null
);
```

### Read-Only Table

```html
<app-chill-table
  [schema]="schema"
  [entities]="entities">
</app-chill-table>
```

### Inline Editing Only

```html
<app-chill-table
  [schema]="schema"
  [entities]="entities"
  [enableInlineEditing]="true"
  (cellEditCommit)="handleEdit($event)">
</app-chill-table>
```

## Styling

The component uses CSS custom properties for theming:

- `--surface-0`, `--surface-2`: Background colors
- `--text-main`, `--text-muted`, `--accent`, `--accent-strong`, `--accent-soft`: Text and accent colors
- `--border-color`: Border colors
- `--shadow`: Box shadow
- `--danger`: Error color

Key CSS classes:

- `.chill-table-shell`: Main container
- `.chill-table`: The table element
- `.data-cell.is-editing`: Editing cell styling
- `.pending-row`: Rows with unsaved changes
- `.deleted-row`: Deleted rows (semi-transparent)
- `.empty-state`: No data or error messages

## Dependencies

The component requires several services and components:

### Services
- `ChillService`: Core Chill API operations
- `WorkspaceDialogService`: Optional dialog operations
- `WorkspaceLayoutService`: Layout editing permissions

### Components
- `ChillI18nLabelComponent`: Internationalized labels
- `ChillI18nButtonLabelComponent`: Internationalized button text
- `ChillPolymorphicInputComponent`: Dynamic input rendering
- `ChillPolymorphicOutputComponent`: Dynamic value display

### Models
- `ChillSchema`: Schema definition
- `ChillEntity`: Entity data structure
- `ChillPropertySchema`: Property definitions

### External Libraries
- `chill-sharp-ng-client`: Chill API client
- Angular Forms modules for reactive forms

## Notes

- The component automatically handles entity change subscriptions and unsubscribes on destruction
- Layout state is persisted to schema metadata using the key `'chill-table-component'`
- Empty states are displayed when no schema properties or entities are available
- The table is responsive with horizontal scrolling on smaller screens
- Row actions and selection columns are sticky positioned for better UX
- Validation focus automatically activates inline editing for the specified cell
