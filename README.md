# pi-semantic-edit

Drop-in replacement for Pi's built-in `edit`. Same `edits[]` contract, so the model keeps writing the calls it already writes; what changes is what happens after the call.

```json
{ "path": "src/foo.ts", "edits": [{ "oldText": "let x = 1;", "newText": "let x = 2;" }] }
```

## Why install it

- **10-pass tolerant matcher.** The built-in requires `oldText` byte-for-byte; this absorbs whitespace, indentation, escape, and Unicode drift (quotes, dashes, ligatures, Cyrillic/Greek homoglyphs). Every pass re-verifies against the real file, so tolerance never means a wrong-location edit.
- **`replaceAll: true`** replaces every occurrence in one edit, which is what renames need.
- **Stale-read guard.** If a match absorbed real content drift and the file changed since the model saw it, the edit is refused with the changed lines. An edit whose text still matches, exactly or modulo formatting, is never refused.
- **Hints, not dead ends.** No-match errors quote the closest real text, name the differing lines, and say what to copy; retries stop being blind.

## Install

```bash
pi install npm:pi-semantic-edit
```

That's it. `edit` now resolves to this tool.

## Legacy input

Aider-format `patch` blocks still work for old sessions; they're deprecated. New sessions use `edits[]`.

## Docs

- [Reference](https://github.com/k3-2o/pi-semantic-edit/blob/main/docs/REFERENCE.md): input contract, matcher passes, safety behaviors, errors
- [Explanation](https://github.com/k3-2o/pi-semantic-edit/blob/main/docs/EXPLANATION.md): why the matcher is built this way

## License

MIT, see [LICENSE](LICENSE).
