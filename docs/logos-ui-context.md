# Logos UI Context

Logos should ship with one default UI context for generated apps:

```logos
ui_context "logos-operational-ui"
```

The first implementation should be a simple, well-trodden operational-app style:

- React + TypeScript
- Tailwind CSS
- shadcn/ui components
- Radix primitives under shadcn
- lucide-react icons
- TanStack Table for non-trivial data tables
- Recharts for simple charts

This style is intentionally conservative. It should feel like a quiet internal tool: table-first, compact, neutral, and easy to scan.

## Product Design

The default Logos app output should look like a polished operational dashboard, not a marketing site.

Core visual rules:

- Use neutral backgrounds, white surfaces, subtle borders, and restrained shadows.
- Use 8px radius or less.
- Use compact type and tabular numbers for financial or operational data.
- Use cards only for headline metrics, repeated records, and modal/dialog surfaces.
- Prefer tables, tabs, filters, sheets, dialogs, dropdowns, tooltips, and forms.
- Use lucide icons in icon buttons and actions.
- Avoid gradients, decorative blobs, oversized hero sections, and hand-drawn controls.
- Avoid hand-rolled buttons, tables, selects, dialogs, and form fields when registry components exist.

Default app surface:

```text
+--------------------------------------------------------------------------------+
| App Name                                              global actions / status    |
+--------------------------------------------------------------------------------+
| KPI      KPI      KPI      KPI      KPI                                        |
+--------------------------------------------------------------------------------+
| Tabs / filters                                                                   |
+--------------------------------------------------------------------------------+
| Primary table or workflow surface                                                |
|                                                                                |
|                                                                                |
+--------------------------------------------------------------------------------+
| Secondary detail panel / drawer / modal when needed                              |
+--------------------------------------------------------------------------------+
```

For the portfolio monitor, this means:

- Headline performance row
- Asset-class contribution table
- Instrument contribution/detractor tables
- No landing-page hero
- No decorative finance imagery
- No chart until the workflow needs one

## Component Inventory

The initial registry should expose a small set of reliable building blocks:

```text
Button
Input
Textarea
Select
Checkbox
Switch
Tabs
Table
Card
Dialog
Sheet
DropdownMenu
Tooltip
Badge
Skeleton
Form
MetricCard
PageShell
DataTable
EmptyState
```

`MetricCard`, `PageShell`, and `DataTable` should be Logos-owned wrappers built from shadcn primitives. They give the compiler stable, domain-appropriate vocabulary without requiring the model to invent layout every time.

## Context Package

The UI context should be installable and injectable. A concrete package shape:

```text
logos-operational-ui/
  registry.json
  components/
    button.tsx
    table.tsx
    tabs.tsx
    dialog.tsx
    sheet.tsx
    tooltip.tsx
    metric-card.tsx
    page-shell.tsx
    data-table.tsx
  tokens/
    theme.css
  rules/
    ui-guidelines.md
  examples/
    portfolio-performance-page.tsx
    approval-workflow-page.tsx
```

The compiler prompt should receive a compact summary, not the whole registry:

```text
Use the logos-operational-ui context.
Use PageShell, MetricCard, DataTable, Tabs, Sheet, Dialog, Form, Button, Badge.
Use tokens from theme.css.
Use lucide-react icons.
Prefer table-first operational layouts.
Do not hand-roll standard controls.
Do not create marketing-style heroes or decorative backgrounds.
```

The actual source files should be available to the generated project through the registry, so the model can import components instead of re-creating them.

## Compiler Integration

The Logos compiler should treat UI context as a compilation input.

High-level flow:

```text
Logos source
  -> parse declarations and app target
  -> resolve ui_context
  -> complete natural/function snippets with UI-context prompt
  -> emit React/TypeScript app
  -> install/copy registry components used by the output
  -> build/run app preview
```

At first, this can be explicit:

```logos
ui_context "logos-operational-ui"

fn main() -> App:
  ```
  render a portfolio performance monitor
  ```
```

If no UI context is declared and the runnable returns `App`, default to `logos-operational-ui`.

The context should affect:

- The completion prompt
- The import/component choices
- The generated project files
- The app preview target
- Visual eval expectations

It should not be a compiler shortcut. The compiler still generates normal TS/React code; the UI context only supplies design vocabulary, component source, and constraints.

## Near-Term Implementation

1. Keep the current HTML artifact path working.
2. Add `ui_context` parsing as metadata.
3. Add a `logos-operational-ui` prompt block.
4. Move app generation from raw HTML strings toward React component output.
5. Add a small registry copy step for used components.
6. Add Playwright screenshot checks for the generated app frame.

The first goal is consistency, not design-system completeness. A small, boring, well-used component set is enough to make generated apps feel much less random.
