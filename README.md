# pi-robust-edit

> A drop-in replacement for Pi's built-in `edit` tool — same name, same description, same prompt, same rendering. The difference is in the backend: a multi-layer matching engine that handles whitespace drift, duplicates, anchors, and variable-name ambiguity.

The model says "old code → new code." The harness finds the right place, disambiguates, verifies, and applies.

---

## Features

- **Exact + normalized matching** — handles trailing whitespace, smart quotes, Unicode dashes, CRLF differences
- **Anchor support** — provide a nearby unique snippet to target a specific function or block
- **Auto-expanding context** — if `oldText` is ambiguous, the harness grows it outward until unique
- **Token fingerprint matching** — disambiguates blocks that look identical but use different variable names
- **Joint old/new scoring** — when still ambiguous, scores candidates by structural fit (brace balance, indentation)
- **Coherence checks** — warns about unbalanced braces or suspicious indentation jumps after editing
- **SEARCH/REPLACE block parsing** — accepts Aider-style `<<<<<<< SEARCH ... >>>>>>> REPLACE` blocks natively
- **Zero runtime dependencies** — uses only Node.js/Bun built-ins
- **Same look and feel as Pi's edit** — same tool name, same description, same TUI rendering, same diff display

---

## Quick Start

```bash
# Install from git
pi install git:https://github.com/your-org/pi-robust-edit.git

# Or load directly from a local checkout
pi -e ./index.ts
```

Once loaded, the extension replaces Pi's built-in `edit` tool. The model calls `edit` as always — it has no idea the backend is different.

---

## Usage

### Basic old/new blocks (JSON)

```json
{
  "path": "src/foo.ts",
  "edits": [
    {
      "oldText": "    console.log('hello');",
      "newText": "    console.log('goodbye');"
    }
  ]
}
```

### With an anchor

When the same `oldText` appears in multiple places, add an `anchor` — a nearby unique snippet like a function signature:

```json
{
  "path": "src/foo.ts",
  "edits": [
    {
      "anchor": "function logMessage() {",
      "oldText": "    console.log('hello');",
      "newText": "    console.log('goodbye');"
    }
  ]
}
```

### SEARCH/REPLACE blocks (patch format)

Instead of JSON, you can use a natural block format that matches how models already express edits in training:

```
src/foo.ts
<<<<<<< SEARCH
    console.log('hello');
=======
    console.log('goodbye');
>>>>>>> REPLACE
```

Send this as the `patch` field:

```json
{
  "patch": "src/foo.ts\n<<<<<<< SEARCH\n    console.log('hello');\n=======\n    console.log('goodbye');\n>>>>>>> REPLACE"
}
```

Multiple blocks can appear in one patch string. The file path is read from the `[filename]` header before each block.

---

## How the matching engine works

When a model sends `oldText` and `newText`, the harness tries these layers in order. The first layer that finds a **unique, unambiguous** match wins.

| Layer | What it does |
|---|---|
| 1. Exact match | `content.indexOf(oldText)` — fast path |
| 2. Normalized match | Strips trailing whitespace, normalizes Unicode quotes/dashes |
| 3. Anchor-constrained | Searches only inside the anchor region |
| 4. Auto-expanding context | Grows `oldText` outward until unique |
| 5. Token fingerprint | Uses identifier relationships to disambiguate variable-name duplicates |
| 6. Joint scoring | Scores each candidate by structural fit (brace balance, indentation) |

If all layers fail, the tool returns a clear error with suggestions — it never guesses.

---

## Coherence warnings

After applying edits, the harness checks the result for:

- **Unbalanced braces/parens/brackets**
- **Suspicious indentation jumps** (more than 4 spaces from neighboring lines)

If any issues are found, they are returned as warnings in the tool output. The edit is still applied — the model can decide whether to revert.

---

## Philosophy

Most edit tools force the model to be precise: reproduce exact text, count line numbers, learn a custom patch syntax. This is backwards. The model is stochastic and context-limited. The harness is deterministic and has full access to the file.

**The right contract:** the model describes the change in the most natural way (old code → new code), and the harness does the painstaking work of locating, disambiguating, verifying, and applying.

This is the same pattern as a compiler: the programmer writes intent, the compiler handles register allocation and optimization. The model should not be doing mechanical work — the harness should.

---

## Skipped and deferred

| Approach | Status | Why |
|---|---|---|
| Bounded fuzzy matching | Skipped | Risk of wrong-location corruption; existing layers cover real failure modes |
| Structural scope pruning | Skipped | Language-specific and fragile; anchors provide the same benefit |
| Reverse-edit verification | Skipped | Over-engineered; coherence check catches the same issues |
| Multi-edit indexing | Deferred | Only matters for files >10K lines |
| Standalone library | Deferred | Needs real-world validation first |
| Per-model prompts | Deferred | No evidence models struggle with the format |
| Whole-file fallback | Deferred | Models already rewrite via `write` or `bash` |

---

## Project structure

```
pi-robust-edit/
├── index.ts              # Pi extension entry point
├── src/
│   ├── tool.ts           # Tool schema, rendering, and Pi integration
│   ├── matcher.ts        # Core matching engine (6 layers)
│   ├── utils.ts          # Diff, line-endings, BOM handling
│   ├── types.ts          # TypeScript interfaces
│   └── path-utils.ts     # Path resolution
├── tests/                # 71 tests across 9 test files
├── AGENT.md              # Behavioral instructions for agents
├── justfile              # fmt, lint, check, test, ci
├── package.json
└── tsconfig.json
```

---

## License

MIT
