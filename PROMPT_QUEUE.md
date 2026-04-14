# Prompt queue

## Workspace task components

- [Check] Switching between tasks component they are created and destroyed? Or simply hidden/showed?
- Create a `WorkspaceTaskComponentInterface` (equilize the name with other workspace related names)
- To allow component to preserve their state when switching between tasks add to `WorkspaceTaskComponentInterface` the `visible` input field. Externally the workspace engine use `[hidden]` to hide the component, but let the component to descide if suppress heavy tasks or components using for example `if(visible) {}`
- Don't pollute browser URL with complex urls containing all task configuration options and keep it clean using only a `openMenuItems` param array of guids with the list of opened menu-items.
Refreshing page reopen tasks starting from menu-items with a fresh component state.
- Add isAllSaved() (or better name) to `WorkspaceTaskComponentInterface` to allow workspace compoents to warn user there is something of unsaved/undone before leaving the page.

## Layout

- Update polimorphic-output to render date time making date part and time part unbreakable allowing word warp only with the space between them.
- MenuItem subitem don't show expand button (`workspace-menu__tree-expander`) on sub items after first element
- After a MenuItem sub items place the button "Add child element" creating a new menu-item like "Add root element", but presetting parent reference.
- Selecting a chillentity on lookup field with openLookupDialog() the polimorphic-input closes after blur so dialog can't update the value properly. Suppress on blur hiding while selecting by dialog. On dialog confirm validate then allow component to close.
- in Crud/Table page make the save button accent color if there are unsaved changes

## 

