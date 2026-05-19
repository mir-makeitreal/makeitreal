import { uniqueValues, pascalName } from "./heuristics.mjs";

export function componentProfileFromRequest({ request, slug }) {
  const text = String(request ?? "");
  if (!/\b(frontend|front-end|fe|ui|client|web|react|component|storybook|aria|keyboard|datatable|data table)\b/i.test(text)) {
    return null;
  }
  const isDataTableRequest = /\bdata[-\s]?table|datatable\b/i.test(text);
  const namedComponent = text.match(/\b([A-Z][A-Za-z0-9]+)\s+component\b/)
    ?? text.match(/\bcomponent\s+([A-Z][A-Za-z0-9]+)\b/);
  const descriptiveComponent = text.match(/\b([a-z][a-z0-9]*(?:[-\s]+[a-z][a-z0-9]*){0,2})[-\s]+(card|widget|banner|modal|form|table)\b/i);
  const componentName = isDataTableRequest
    ? "DataTable"
    : namedComponent?.[1]
      ?? (descriptiveComponent
        ? pascalName(`${descriptiveComponent[1]}-${descriptiveComponent[2]}`.replace(/\b(a|an|the|react|reusable|frontend|front-end|ui)\b/gi, ""))
        : pascalName(slug.replace(/^(fe|ui|web|frontend)-/, "")));
  const capabilities = [
    [/sort/i, "sorting"],
    [/paginat/i, "pagination"],
    [/select/i, "selection"],
    [/sticky/i, "sticky headers"],
    [/empty/i, "empty state"],
    [/loading/i, "loading state"],
    [/error/i, "error state"],
    [/aria|accessib|a11y/i, "ARIA semantics"],
    [/keyboard/i, "keyboard navigation"],
    [/storybook/i, "Storybook story coverage"],
    [/visual|screenshot/i, "visual regression evidence"]
  ].filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  const dataTableProps = [
    { name: "columns", type: "ColumnDefinition[]", required: true, description: "Column id, header, cell renderer, sorting metadata, and optional width/pinning metadata." },
    { name: "rows", type: "RowData[]", required: true, description: "Rows rendered by the table; the component must not fetch data implicitly." },
    { name: "rowKey", type: "(row: RowData) => string", required: true, description: "Stable row identity used for selection, focus, and virtualization-safe updates." },
    { name: "sortState", type: "SortState", required: false, description: "Controlled sorting state declared by column id and direction." },
    { name: "paginationState", type: "PaginationState", required: false, description: "Controlled page index and page size when pagination is enabled." },
    { name: "selectionState", type: "SelectionState", required: false, description: "Controlled selected row ids when row selection is enabled." },
    { name: "status", type: "\"loading\" | \"empty\" | \"error\" | \"ready\"", required: true, description: "Explicit render state; the component must not infer hidden fallback states." },
    { name: "onSortChange", type: "(next: SortState) => void", required: false, description: "Sorting event callback." },
    { name: "onPageChange", type: "(next: PaginationState) => void", required: false, description: "Pagination event callback." },
    { name: "onSelectionChange", type: "(next: SelectionState) => void", required: false, description: "Row-selection event callback." }
  ];
  const genericProps = [
    ...[
      ["title", "string", true, "Primary text rendered by the component."],
      ["label", "string", true, "Visible label text rendered by the component."],
      ["subtitle", "string", false, "Supporting text rendered under the primary title."],
      ["description", "string", false, "Longer descriptive copy for the component."],
      ["ctaLabel", "string", false, "Visible label for the primary call to action."],
      ["ctaHref", "string", false, "Navigation target for the primary call to action."],
      ["avatarUrl", "string", false, "Optional avatar or image source shown by the component."],
      ["planBadge", "string", false, "Optional badge text for account, plan, or status labeling."],
      ["tone", "\"default\" | \"success\" | \"warning\" | \"danger\" | \"info\"", false, "Declared visual tone variants; do not invent additional variants without Blueprint revision."],
      ["variant", "string", false, "Declared visual variant when the request explicitly needs variants."],
      ["status", "\"loading\" | \"empty\" | \"error\" | \"ready\"", true, "Explicit render state; the component must not infer hidden fallback states."],
      ["errorMessage", "string", false, "Displayed only for the declared error state."]
    ]
      .filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text) || (name === "status" && /\b(loading|empty|error|ready|state)\b/i.test(text)) || (name === "tone" && /\b(tone|success|warning|danger|info)\b/i.test(text)))
      .map(([name, type, required, description]) => ({ name, type, required, description })),
    ...[
      ["onRetry", "(event: UIEvent) => void", "Retry callback for recoverable error state."],
      ["onClick", "(event: UIEvent) => void", "Click callback for the primary interactive control."],
      ["onSubmit", "(event: FormEvent) => void", "Submit callback for form-like components."],
      ["onDismiss", "(event: UIEvent) => void", "Dismiss callback for dismissible components."]
    ]
      .filter(([name]) => new RegExp(`\\b${name}\\b`, "i").test(text) || (name === "onRetry" && /\bretry\b/i.test(text)) || (name === "onClick" && /\bclick|cta|button\b/i.test(text)) || (name === "onSubmit" && /\bsubmit|form\b/i.test(text)) || (name === "onDismiss" && /\bdismiss|close\b/i.test(text)))
      .map(([name, type, description]) => ({ name, type, required: false, description }))
  ];
  if (genericProps.length === 0) {
    genericProps.push(
      { name: "data", type: "array", required: true, description: "Rows or view model data rendered by the component." },
      { name: "state", type: "component-state", required: true, description: "Declared loading, empty, error, and ready states." },
      { name: "onChange", type: "event callback", required: false, description: "Declared user interaction callback surface." }
    );
  }
  const isDataTable = componentName === "DataTable";
  return {
    componentName,
    capabilities: capabilities.length > 0 ? capabilities : ["declared component behavior"],
    props: isDataTable ? dataTableProps : genericProps,
    storybookStories: isDataTable
      ? ["ready", "loading", "empty", "error", "sorted", "paginated", "selected", "sticky-header"]
      : uniqueValues(["ready", ...capabilities.filter((capability) => /loading|empty|error/i.test(capability)).map((capability) => capability.replace(/\s+state$/i, "")), /\btone|variant|success|warning|danger|info\b/i.test(text) ? "variants" : null]),
    ariaChecklist: isDataTable
      ? ["role=grid or semantic table", "aria-sort reflects sort state", "aria-selected reflects row selection", "focus stays visible during keyboard navigation"]
      : ["named region or landmark where applicable", "interactive controls expose accessible names"],
    keyboardMap: isDataTable
      ? [
          { key: "ArrowUp/ArrowDown", behavior: "Move focused row or cell without losing table context." },
          { key: "Home/End", behavior: "Move to first or last row/cell in the active axis." },
          { key: "PageUp/PageDown", behavior: "Change page or viewport chunk when pagination is enabled." },
          { key: "Space/Enter", behavior: "Toggle selectable row or activate focused cell action." }
        ]
      : []
  };
}
