# Workspace Dialog Service

## Overview

`WorkspaceDialogService` manages the modal dialog stack used across the workspace. It opens component-based dialogs and resolves them with a typed result object.

## Result Contract

`openDialog<TResult>()` resolves to:

```typescript
{
  status: 'confirmed' | 'cancelled';
  value?: TResult;
}
```

`confirm(value?)` closes the active dialog with:

- `status: 'confirmed'`
- the optional `value` payload passed to `confirm(...)`

`cancel()` closes the active dialog with:

- `status: 'cancelled'`
- no value payload

## Dialog Form Integration

The dialog service is part of the default CRUD edit flow:

1. `CrudPageComponent` opens `ChillFormComponent` with `openDialog<ChillEntity>()`.
2. `ChillFormComponent` performs default `create()` or `update()` during submit.
3. On success, the form calls `dialog.confirm(savedEntity)`.
4. The CRUD page receives `result.value` as the saved entity and replaces the edited row with that returned server copy.

This pattern turns the dialog result into a transport for the persisted entity payload instead of using the dialog only as a boolean confirm/cancel boundary.

## Confirm Helpers

The service also exposes:

- `confirmOk(title, description)`
- `confirmYesNo(title, description)`

These helpers are convenience wrappers built on top of `openDialog<TResult>()`.
