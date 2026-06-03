# Build Project Grid

Confidence: 84%

## When to use
Use this when implementing a new grid, table, search result screen, Kendo grid feature, or column-heavy UI.

## Examples
- Add a new grid using `src/app/orders/orders-grid.component.ts` as the closest example.
- Change table columns, search behavior, pagination, or export behavior.

## Observed repo conventions
- Grid-related changes most often appear under `src/app/orders`, `src/app/invoices`.
- File names or commit messages repeatedly use grid, Kendo, table, or columns terminology.
- Grid work often includes nearby unit or e2e test updates.

## Workflow
1. Find the nearest existing grid or table implementation.
2. Reuse the existing column definition and data loading pattern.
3. Add search, reset, pagination, sorting, and export behavior only when the nearby example supports it.
4. Keep template, component, service, and model changes in the same feature area.
5. Add or update tests that cover the visible grid behavior.

## Validation
- npm test
- npm run lint
- npm run e2e
- Review the changed files against the nearest existing example before handing off.

## Evidence
- `abc1234`: Add orders grid
- `def5678`: Add invoice table columns

## Common files and directories
- Common files:
  - src/app/orders/orders-grid.component.ts
  - src/app/invoices/invoices-table.component.ts
- Common directories:
  - src/app/orders
  - src/app/invoices
