# pi-semantic-edit

Drop-in replacement for Pi's built-in `edit`. Same `edits[]` contract, so the model keeps writing the calls it already writes. What changes is what happens after the call: the matcher absorbs the drift models actually produce, and failures say what to fix instead of bouncing the model into a blind retry.

```json
{ "path": "src/foo.ts", "edits": [{ "oldText": "let x = 1;", "newText": "let x = 2;" }] }
```

## Why you'd install it

The built-in edit is strict. `oldText` has to match the file byte for byte, and when it doesn't the model retries in the dark. This one runs the text through a 10-pass fuzzy chain (line trim, indentation, escaped sequences, Unicode quotes and dashes) before giving up. Every pass re-verifies its match against the actual file, so tolerance never turns into an edit at the wrong location.

A behavior the built-in lacks:

- `replaceAll: true` on an edit replaces every occurrence. That's what renames actually need; without it a multi-match fails with the line positions and you add context.

On no-match the error quotes the closest real text plus a similarity percentage, so the retry targets what's actually in the file, not what the model remembers.

## Install

```bash
pi install npm:pi-semantic-edit
```

That's it. `edit` now resolves to this tool.

## Legacy input

Aider-format `patch` blocks still work for sessions that started on older versions, but they're deprecated. New sessions should use `edits[]`.

## Docs

- [Reference](https://github.com/k3-2o/pi-semantic-edit/blob/main/docs/REFERENCE.md): input format, matcher passes, safety behaviors, errors
- [Explanation](https://github.com/k3-2o/pi-semantic-edit/blob/main/docs/EXPLANATION.md): why the matcher is built this way

## License

MIT, see [LICENSE](LICENSE).
