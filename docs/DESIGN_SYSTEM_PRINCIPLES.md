# UI/UX Design Principles: Dense & Sleek

## 1. Core Philosophy: Information First (Anti-Card)
While cards are common in modern web design, they often prioritize "chunking" over "density," leading to excessive whitespace and inefficient use of screen real estate. This project prioritizes **Information Density** and **Functional Clarity**.

### 🚫 Anti-Patterns (Avoid)
- **Excessive Card Nesting**: Using cards for every grouping.
- **Large Shadows & Rounded Corners**: These often require extra padding to look "balanced," wasting space.
- **Static Grids of Cards**: Often better served by tables or list items with dividers.

### ✅ Preferred Patterns
- **Divider-Based Structure**: Use subtle borders (`border-b`, `border-r`) or background variations to distinguish sections.
- **List-Centric Layouts**: Present related data in rows rather than individual cards.
- **Compact Padding**: Minimize vertical and horizontal padding where possible without sacrificing readability.
- **Interactive States**: Use background color shifts and subtle font weight changes instead of complex box-shadow transitions.

## 2. Layout Guidelines

### 2.1 Dividers over Containers
Instead of putting content in a container with a border and shadow:
```tsx
// ❌ Avoid
<div className="bg-card border rounded-xl p-4 shadow-sm">
  <h3>Title</h3>
  <p>Content</p>
</div>

// ✅ Preferred
<div className="py-2 border-b border-border/60">
  <h3 className="text-sm font-bold">Title</h3>
  <p className="text-xs text-muted-foreground">Content</p>
</div>
```

### 2.2 Horizontal Key-Value Lists
For status indicators, use a horizontal list separated by dividers or dots.

```tsx
// ✅ Example
<div className="flex items-center gap-4 text-xs">
  <div className="flex items-center gap-2"><span>Status:</span> <span className="text-green-500">Live</span></div>
  <div className="w-px h-3 bg-border" />
  <div className="flex items-center gap-2"><span>Latency:</span> <span>120ms</span></div>
</div>
```

### 2.3 Dense Tables
Use tables with minimal padding and clear header distinction. Avoid wrapping tables in heavy "card" containers.

## 3. Visual Language
- **Colors**: Use a neutral palette with vibrant accents for status (SUCCESS/ERROR/INFO).
- **Typography**: Small but highly legible fonts for data-heavy views. Use monospaced fonts for numerical data and IDs.
- **Micro-interactions**: Use transitions on background colors and opacity, rather than physical "lifting" effects.
