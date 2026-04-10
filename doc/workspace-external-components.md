# Workspace External Components

This document describes how to publish external workspace task components that `chill-sharp-ng-ui` can discover and load at runtime.

## Overview

- Host application: `chill-sharp-ng-ui`
- Discovery mechanism: runtime task source indexes
- Runtime binding: `globalThis.__chillSharpNgUiRuntimeConfig__.workspaceTaskSources`
- Component contract: standalone Angular component exposed through Module Federation
- Built-in exception: the `CRUD` task stays implemented inside the host application

At startup the host reads every configured source URL, downloads its `workspace-tasks.index.json`, and registers the tasks listed there by `componentName`.

`MenuItem.ComponentName` must match one registered `componentName`.
`MenuItem.ComponentConfigurationJson` is passed to the loaded task component as the `componentConfiguration` input.
The workspace menu editor builds the `ComponentName` dropdown from the registered task definitions, including tasks discovered from external sources.

## Runtime Configuration

The host loads [`public/runtime-config.js`](/c:/source/personal/chill-sharp-ng-ui/public/runtime-config.js) before Angular bootstraps.

Default shape:

```js
globalThis.__chillSharpNgUiRuntimeConfig__ = {
  workspaceTaskSources: [
    "https://tasks.company.net/finance/",
    "https://tasks.company.net/hr/workspace-tasks.index.json"
  ]
};
```

In deployment, generate that file from an environment variable such as:

```text
CHILL_SHARP_NG_UI_WORKSPACE_TASK_SOURCES=https://tasks.company.net/finance/,https://tasks.company.net/hr/
```

and split it into the JavaScript array above.

## Source Index Format

Each source must expose `workspace-tasks.index.json` unless the configured URL already points directly to a `.json` file.

Example:

```json
{
  "sourceName": "finance-tools",
  "tasks": [
    {
      "componentName": "finance-dashboard",
      "title": "Finance Dashboard",
      "description": "Cross-module finance workspace",
      "remoteEntry": "./remoteEntry.js",
      "remoteName": "financeTasks",
      "exposedModule": "./DashboardTask",
      "exportedComponentName": "FinanceDashboardTaskComponent",
      "showInQuickLaunch": false
    }
  ]
}
```

Field meanings:

- `componentName`: unique identifier used by `MenuItem.ComponentName`
- `title`: default tab title when no menu title override is provided
- `description`: default description when no menu description override is provided
- `remoteEntry`: absolute URL or source-relative URL to the federation entry file
- `remoteName`: global container name exposed by the remote
- `exposedModule`: module key exposed by Module Federation
- `exportedComponentName`: named export to read from the exposed module, defaults to `default`
- `showInQuickLaunch`: optional flag to show the task in the quick-launch area

## External Component Contract

Import the shared types from [`src/app/workspace/external-task-api.ts`](/c:/source/personal/chill-sharp-ng-ui/src/app/workspace/external-task-api.ts).

Expected inputs for remote components:

- `componentConfiguration`: parsed object from `MenuItem.ComponentConfigurationJson`
- `taskTitle`: effective task title
- `taskDescription`: effective task description

Minimal example:

```ts
import { Component, input } from '@angular/core';
import type { WorkspaceTaskComponent, WorkspaceTaskConfiguration } from 'src/app/workspace/external-task-api';

@Component({
  selector: 'finance-dashboard-task',
  standalone: true,
  template: `
    <section>
      <h2>{{ taskTitle() }}</h2>
      <pre>{{ componentConfiguration() | json }}</pre>
    </section>
  `
})
export class FinanceDashboardTaskComponent implements WorkspaceTaskComponent {
  readonly componentConfiguration = input<WorkspaceTaskConfiguration>({});
  readonly taskTitle = input('Finance Dashboard');
  readonly taskDescription = input('');
}
```

## Module Federation Expectations

The host loads `remoteEntry.js` dynamically and uses the standard container API:

- `window[remoteName]`
- `container.init(...)`
- `container.get(exposedModule)`

The exposed module must return an Angular standalone component export.

Example webpack federation snippet:

```js
new ModuleFederationPlugin({
  name: 'financeTasks',
  filename: 'remoteEntry.js',
  exposes: {
    './DashboardTask': './src/app/finance-dashboard-task.component.ts'
  }
});
```

If your remote does not share Angular packages with the host, bundle the required Angular runtime inside the remote output.

## Publishing Steps

1. Build the standalone workspace component library or remote app.
2. Publish the generated `remoteEntry.js` and its chunks to a static URL.
3. Publish `workspace-tasks.index.json` beside the remote assets, or publish it separately and point the host directly at that JSON URL.
4. Add a `MenuItem` with:
   - `ComponentName`: the index `componentName`
   - `ComponentConfigurationJson`: startup configuration for the component
5. Update the host runtime config so `workspaceTaskSources` includes the source URL.

## Menu Editor Metadata

The host form renderer now supports `CHILL_PROPERTY_TYPE.Select = 90`.

Select options are stored in property metadata as an `options` array of `[value, text]` tuples:

```ts
metadata: {
  options: [
    ['', 'Menu empty node'],
    ['crud', 'CRUD (crud)'],
    ['finance-dashboard', 'Finance Dashboard (finance-dashboard)']
  ]
}
```

The workspace menu item dialog uses this metadata shape to render the `ComponentName` field as a dropdown.

## Menu Configuration Example

```json
{
  "tenantCode": "ACME",
  "defaultReport": "monthly-close",
  "canExport": true
}
```

When that menu item is opened, the host passes the parsed object to the remote component as `componentConfiguration`.
