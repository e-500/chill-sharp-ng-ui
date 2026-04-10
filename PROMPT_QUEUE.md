# Prompt queue

## User, Role and Permission managment refactoring OK

Refactor permission-page:
- Remove link from the "workspace-menu" and put it in the "user-menu" replacing "user profile" link to dialog.
In the permission-page
- Create the following links in the workspace-toolbar: users, roles
- Clicking on a link will opened user-permission and role-permission components in the page.
Refactor user-permission and role-permission components as follow:
- Under the title place an input field similar to polymorphic-input in lookup mode to `search and select` the `user` or the `role` (try to reuse, but search is different; don't change polymorphic-input component) 
- On the right of the select input field place a "Add" button to create a new user or role using a form dialog.
- When a user is created and dialog closed autoselect the new `user` or `role` in to the `search and select` input field.
- Once the user or the role is selected in the `search and select` input field:
  - Show an "Edit" button to edit user detail in a form dialog.
  - Show the permission-editor as is but without the search and select sidebar-card

## Indrodicing Google fonts icons OK

Introduce Google fonts icons without including in the index.html external links but ebbedding all the necessary files into the project.
Introduce only icons into crud-page for Add, Edit, Search and Delete buttons in workspace-toolbar.
Create in `doc\` a google-icons-update.md file with the procedure to update icons to latest version.

## Bugfix taskbar elements BETTER BUT NOT PERFECT

- Task switching sometimes miss showing the empty workspace placeholder "nothing shows after click".
- Using id can be repeated opening the same task type so the select may select the wrong task: use `crypto.randomUUID()` to generate a unique id and move current id value to type (or better name) to be used in the url.

## Specific I18n text not rendered OK

In the workspace-menu the text ({{ chill.T('96C1B2E5-D6CA-4C53-8353-D97D4F8E0B09', 'No menu items are available for the current user.', 'Nessuna voce menu disponibile per l'utente corrente.') }}) is printed on the screen instead of the correct string. All the other text are rendered correctly. Check condition `@else if (menuRoots().length === 0)`

## Automatic and persitent theme choice OK

Select the theme by default using system bright/dark mode.
Once user select a different theme store it in a variable using localStorage to reopen it using the same settings (before check if already does it)

## Workspace Task abstraction layer OK TEST NEEDED

Create an abstraction layer for workspace tasks in order to have external task components loaded at runtime by name.
Task source repositories can be binded at runtime using a ENV_VAR containing a list or urls of the source locations.
Once the app starts read the index from each source in order to allow workspace to init the component.
- Each component has is own startup configuration stored in `MenuItem` in `ComponentConfigurationJson` with `ComponentName` used to identify uniquely the component across all the component sources.
- The external component are created using `Module Federation` 
- CRUD module remains built-in in the main project
- Export the interfaces to be used for creating external components
- Write a .md guide (place it in `doc\`) on how to build and publish an external component libs.

## Workspace external components list

Loading sources, build a list to be used in menu edit form to transform componentName in a select input with a complete list of options.
Add the empty option labeled 'Menu empty node' with '' value.
If necessary update documentation: "C:\source\personal\chill-sharp-ng-ui\doc\workspace-external-components.md"


