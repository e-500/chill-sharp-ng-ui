# Prompt queue

According to new menu endpoints in chill-sharp:
C:\source\personal\chill-sharp\chill-sharp\ext\chill-sharp-ng-client\README.md
C:\source\personal\chill-sharp\chill-sharp\doc\MenuModel.md

Using get-menu() endpoint:
Create a menu as first element in the "workspace-menu" left area.
The menu must be shown as collapsed initial showing only root nodes.
When a menu-item is shown get his child nodes to show expand button and be ready in case user epand it.

If user press F2 and enable edit (LayoutEditingEnabled) allow user to:
Add/Edit/Remove root or child menu-items.

The editing of a menu-item is done using a custom form in a dialog and saved using (set-menu() endpoint).


Create polymorphic-input dedicated to json strings (CHILL_PROPERTY_TYPE.Json) using Monaco editor.
The data is stored in the form field ad a string and not as an object.