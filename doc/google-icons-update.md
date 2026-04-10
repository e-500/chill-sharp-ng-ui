# Google Icons Update Procedure

This project self-hosts Google Material Symbols icons. No external icon stylesheet is loaded from `index.html`.

## Current setup

- NPM package: `@fontsource/material-symbols`
- Bundled font files:
  - `public/fonts/material-symbols.woff2`
  - `public/fonts/material-symbols.woff`
- Global font-face and shared icon class:
  - `src/styles.scss`

## Update steps

1. Update the package to the latest version:

```powershell
npm install @fontsource/material-symbols@latest
```

2. Copy the newest font files from the package into the app public assets:

```powershell
Copy-Item node_modules/@fontsource/material-symbols/files/material-symbols-latin-400-normal.woff public/fonts/material-symbols.woff
Copy-Item node_modules/@fontsource/material-symbols/files/material-symbols-latin-400-normal.woff2 public/fonts/material-symbols.woff2
```

3. Confirm the global font-face still points to the local files in `src/styles.scss`:

```scss
@font-face {
  font-family: 'Material Symbols';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src:
    url('/fonts/material-symbols.woff2') format('woff2'),
    url('/fonts/material-symbols.woff') format('woff');
}
```

4. Build the application and verify icons render correctly:

```powershell
npm run build
```

## Where icons are used

- Workspace toolbar icon rendering:
  - `src/app/layouts/workspace-page.component.ts`
  - `src/app/services/workspace-toolbar.service.ts`
- CRUD toolbar button definitions:
  - `src/app/tasks/crud-task/crud-task.component.ts`
- CRUD row action icon rendering:
  - `src/app/pages/crud/crud-page.component.ts`
  - `src/app/lib/chill-table.component.ts`
  - `src/app/lib/chill-table.component.html`
  - `src/app/lib/chill-table.component.scss`

## Notes

- The project currently uses the `400` weight font files.
- If Google or `@fontsource` changes file names in a future release, inspect:

```powershell
Get-ChildItem node_modules/@fontsource/material-symbols/files
```

- After updating, visually check CRUD `Search`, `Add`, `Edit`, and `Delete` icons.
