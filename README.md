# pi-semantic-edit

> A drop-in replacement for Pi's built-in `edit` tool. Same `edits[]` contract, same model-facing behavior — but the matcher tolerates the drift models actually produce, and the failure messages tell the model exactly what to fix.

## Features

- **Pi's built-in contract** — `{ path, edits: [{ oldText, newText, replaceAll? }] }`. The model writes the same shape it already uses for Pi's built-in edit; nothing new to learn.
- **`replaceAll` escape hatch** — set `replaceAll: true` on an edit to replace every occurrence (renames, repeated patterns) instead of failing on ambiguity.
- **10-pass fuzzy matcher** — exact match first, then progressively tolerant passes for whitespace, indentation, escapes, and Unicode drift (smart quotes, dashes, non-breaking spaces).
- **Never guesses** — ambiguous matches fail with the exact line positions; a fuzzy pass can never match a span far larger than the query (disproportionate-match refusal).
- **Stale-read protection** — rejects edits to files that changed since the model last read them.
- **Zero runtime dependencies** — Node/Bun built-ins only.

## Quick Start

```bash
# Install
pi install npm:pi-semantic-edit

# Or try it without installing
pi -e npm:pi-semantic-edit
```

Pi packages run with full system access — review the source before using.

Once loaded, the tool replaces Pi's built-in `edit`. The model calls `edit` with `path` and `edits[]`:

```json
{ "path": "src/foo.ts", "edits": [{ "oldText": "let x = 1;", "newText": "let x = 2;" }] }
```

## Usage

Edit a file by describing each change as an exact-text replacement:

```json
{ "path": "src/foo.ts", "edits": [{ "oldText": "let x = 1;", "newText": "let x = 2;" }] }
```

Multiple disjoint edits in one call:

```json
{
  "path": "src/a.ts",
  "edits": [
    { "oldText": "alpha", "newText": "ALPHA" },
    { "oldText": "beta", "newText": "BETA" }
  ]
}
```

Replace every occurrence of a token (rename a variable):

```json
{
  "path": "src/a.ts",
  "edits": [{ "oldText": "total", "newText": "sumTotal", "replaceAll": true }]
}
```

The matcher tolerates minor drift between `oldText` and the file — trailing whitespace, indentation, line endings, escaped sequences, and typographic quotes all normalize during matching.

If `oldText` matches more than one location, the edit fails with the line positions and asks for more context — the file is left untouched. If nothing matches, the error shows the closest text actually in the file so the correction can target reality.

> **Legacy:** aider-format SEARCH/REPLACE `patch` input is still accepted (for sessions that started on earlier versions) but deprecated. The model-facing contract is `edits[]`.

## Documentation

- [Reference](docs/REFERENCE.md) — input format, matcher passes, safety behaviors, error behavior
- [Explanation](docs/EXPLANATION.md) — why the format and the matcher are designed this way

## License

MIT — see [LICENSE](LICENSE).
