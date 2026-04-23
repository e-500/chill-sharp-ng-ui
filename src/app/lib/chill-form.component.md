# Chill Form Component

## Overview

`ChillFormComponent` is a schema-driven reactive form used for entity editing and query editing. In dialog entity mode it can run the full server workflow autonomously:

- blur-triggered `autocomplete()`
- submit-time `validate()`
- default `create()` or `update()`
- dialog confirmation with the saved entity returned by the server

An external component can still override submit behavior through `onSubmit`. When that happens, the form hides its internal submit button and leaves the save action to the host component.

## Main Inputs

| Input | Type | Description |
|---|---|---|
| `schema` | `ChillSchema \| null` | Schema used to build controls and layout items. |
| `entity` | `ChillEntity \| null` | Entity source for edit/create dialogs. |
| `query` | `ChillQuery \| null` | Query source when the component is used as a query form. |
| `renderSubmitInsideForm` | `boolean` | Renders the internal submit button only when no custom submit handler is provided. |
| `onSubmit` | `((event: ChillFormSubmitEvent) => void \| Promise<void>) \| null` | Optional external submit override. |
| `closeDialogOnSubmit` | `boolean` | If `true`, closes the dialog after a successful custom submit. Default entity submit closes the dialog itself with the saved entity payload. |
| `submitError` | `string \| (() => string) \| null` | Host-provided submit error message. |
| `dismissSubmitError` | `(() => void) \| null` | Host callback used to clear external submit errors. |

## Output

| Output | Type | Description |
|---|---|---|
| `formSubmit` | `ChillFormSubmitEvent` | Fired before custom or default submit execution. |

## Validation And Autocomplete

### Client-side validation

- Angular `FormControl` validation runs on normal input changes.
- Property validity is tracked separately so polymorphic child components can report invalid state back to the form.
- Input changes do not trigger server validation.

### Server-side validation

- Server validation runs only during submit in entity mode.
- `validate()` errors are split into field errors and generic form errors.
- Field errors are stored in `serverFieldErrors` and forwarded to the input component through `externalErrors`.
- When the user edits a field again, matching server errors are cleared from the form state.

### Autocomplete

- `autocomplete()` runs on property blur, not on change.
- The form tracks pending autocomplete requests and the submit flow waits for them to finish.
- Submit stays available while autocomplete is running, so a Save click is queued and continues after autocomplete completes.
- Returned values are applied back into the form, except for the field that triggered blur, or the currently focused field, when that control is dirty and non-null.

This prevents autocomplete from overwriting the field the user is actively editing, including values saved from the expanded text editor dialog, while still allowing the server to update dependent fields.

## Dialog Entity Submit Flow

When the form is hosted inside a dialog for entity editing, submit works like this:

1. The current focused input is blurred.
2. Any pending blur-triggered autocomplete request is awaited.
3. Client-side validity is checked.
4. `validate()` is executed against the current payload.
5. If validation succeeds:
   - a custom `onSubmit` handler is awaited, or
   - the default entity submit calls `create()` or `update()`
6. The default entity submit closes the dialog with `dialog.confirm(savedEntity)`, where `savedEntity` is the server-returned entity copy.

That returned entity is the contract used by the CRUD page to replace the edited row immediately.

## Custom Submit Override

If `onSubmit` is supplied:

- the form still emits `formSubmit`
- the form still performs the standard submit preconditions, including pending autocomplete flush and submit-time validation in entity mode
- the internal submit button is hidden
- the host component is responsible for rendering its own submit action
- the host decides whether and when the surrounding dialog should be closed

This allows external components to keep the form lifecycle but replace the persistence strategy.

## Error Lifecycle

- Field-level server validation errors stay attached until the relevant field changes.
- Generic validation errors are rendered at form level.
- Autocomplete failures do not close the dialog and do not bypass submit-time validation.
- A failed submit does not permanently block later submits; after the user changes data, the next submit repeats blur, autocomplete, validate, and save in the same order.

## Public Methods

| Method | Description |
|---|---|
| `submit()` | Flushes pending autocomplete, validates entity payload when needed, then runs custom or default submit. |
| `toggleEditMode()` | Toggles form layout edit mode. |
| `updateFields()` | Applies programmatic field updates and clears matching stored server errors. |
| `updatePropertyValidity()` | Stores child property validity reported by polymorphic inputs. |
| `clearSubmitError()` | Clears internal and external submit error state. |

## Typical Dialog Usage

```html
<app-chill-form
  [schema]="schema"
  [entity]="entity"
  [renderSubmitInsideForm]="false"
  [closeDialogOnSubmit]="false">
</app-chill-form>
```

In this configuration the dialog action bar owns the visible submit button, while the form still owns autocomplete, validation, and default entity persistence.
