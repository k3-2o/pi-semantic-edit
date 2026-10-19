# Explanation

Why this tool is designed the way it is.

## The contract: the built-in's format, with the harness doing the work

An LLM editing a file describes a change (a location plus a replacement); separate software applies it. Failures come from two sources:

1. **Generation failures.** The model emits a malformed or semantically wrong edit.
2. **Application failures.** The instruction is well-formed but does not land: drifted whitespace, tabs vs. spaces, a stale view of the file.

A better *format* fixes only the first; a better *matcher* fixes the second, and does most of the work in practice.

The tool's input is **Pi's built-in `edits[]` contract**, plus one optional per-edit `replaceAll` field:

- The built-in's own prompt guidelines already steer the model to `edits[]`; adopting it means zero new format to learn. The tool shadows the built-in so completely that the model notices nothing until its edit drifts and tolerance kicks in.
- `replaceAll` is the escape hatch for rename-everywhere edits, with OpenDev (`replace_all`) and OpenCode (`replaceAll`) precedent.
- The aider SEARCH/REPLACE block format is legacy, designed before standardized tool calls. Still accepted (deprecated) so old sessions keep working; not the contract.

Edit tools (Pi, OpenDev, OpenCode) all share the same search/replace family; they differ only in what the harness does after the call. No format is perfect; the harness absorbs the imperfection.

## The matcher: a failure-log-evolved chain

The 10-pass chain ports [OpenDev](https://github.com/opendev-to/opendev)'s `edit_file` matcher (MIT), described in [arXiv:2603.05344](https://arxiv.org/abs/2603.05344). OpenDev evolved from a two-pass matcher (exact + whitespace-stripped), its largest source of "content not found" errors, into nine targeted passes after failure-log analysis showed formatting drift falls into distinct, predictable categories. Appendix D enumerates the passes and their thresholds; the port preserves them exactly.

The port keeps the safety invariant: **every pass returns only text verified to exist in the file.** A pass that returns other text would be a wrong-location edit, the one failure class this project refuses to accept. A failed edit is a retry; a wrong edit is a bug.

### Our additions

- **Unicode pass (10th).** OpenDev has no Unicode handling. NFKC covers non-breaking spaces and ligatures, but not typographic quotes or dashes (they have no compatibility decomposition); small punctuation and confusable maps (Cyrillic/Greek lookalikes) sit on top.
- **Auto-expand.** On ambiguity, grows context until exactly one occurrence is uniquely identifiable; simultaneous uniqueness means genuine ambiguity. If the unique context still contains a sibling occurrence, the uniqueness came from the file edge, not meaning; refuse instead of guessing.
- **replaceAll.** Replaces every occurrence in one edit, skipping the ambiguity error (OpenDev/OpenCode precedent).
- **Disproportionate-match refusal.** A fuzzy pass must never match a span far larger than the query; refuse rather than apply a wrong edit (OpenCode precedent).
- **Coherence warnings.** Non-blocking checks (brace balance, indentation jumps) for edits that applied but structurally broke the file.

## The failure contract

Every failed edit leaves the file untouched and states **what was found** and **what to do next**:

- Ambiguous: line positions plus the `replaceAll` hint
- Not found: closest candidate plus similarity percentage
- Disproportionate: matched span too large, provide the full exact text
- Overlap / no-op / validation: explicit reason and fix

The goal: the model never drops to a python script, `awk`, or `sed` to apply an edit out of frustration.

## What was deliberately rejected

| Approach | Why not |
|---|---|
| Unified-diff format | `@@` line-number headers are the biggest failure point; models miscount lines |
| Joint scoring (blend all pass signals) | Breaks traceability; you always know *which pass* matched, which keeps failures debuggable |
| Token fingerprint (identifier-based disambiguation) | Speculative; auto-expand + ambiguity errors cover the narrow case without wrong-location risk |
| AST-scoped anchoring | The model already disambiguates by including a function signature line; per-language parsers add fragility for no measured gain |
| Whole-file rewrite format | A second model-facing format reintroduces the format-choice problem; models already have `write` |
| Incremental multi-edit | More failure-prone; the built-in promises non-incremental matching |
| LSP diagnostics feedback | Violates the zero-dependency constraint; heavier than coherence warnings |
| Content-snapshot stale guard | Needs permission-layer cooperation the extension architecture lacks; the mtime registry (paper §2.4.2) was tried and removed, see below |
| Stale-read guard (`ReadRegistry`, mtime + 50ms) | Removed 2026-08-04: the blanket mtime variant forced re-read loops whenever a formatter, git, or editor touched a file after the model's read. Reinstated 0.7.0, evidence-gated: refuses only a content-absorbing match (similarity pass, or a simple match landing mid-token) whose changed lines overlap the matched span, on a file whose content changed since the model saw it. Unrelated changes and verbatim or formatting-class matches never refuse. See [Reference → Staleness handling](REFERENCE.md) |
| Pass 11 `unicode_trimmed` (compose pass 2 + pass 10) | PROPOSAL-11. The fused form beats all 10 passes in one analytic case (query dirtier than the file in both trailing whitespace and typographic punctuation), verified, but zero observed instances across the torture suite, OpenDev's failure logs, and reviewed benchmarks. The chain grows by failure data, not hypothesis. Re-entry requires a wild failure matching PROPOSAL-11 §2.3, with the fast path fixed |

## Sources

- Bui, N. D. Q., "Building Effective AI Coding Agents for the Terminal," arXiv:2603.05344. Matcher design: Appendix D pass catalog, §2.4.2 stale-read/locking, §3.4 absorbing LLM imprecision.
- [opendev-to/opendev](https://github.com/opendev-to/opendev): the Rust reference this tool ports.
- [sst/opencode](https://github.com/sst/opencode): `replaceAll` and disproportionate-match refusal precedents.
- Pi's built-in `edit` (`packages/coding-agent/src/core/tools/edit.ts`): the `edits[]` contract, legacy coercion, rendering parity.
