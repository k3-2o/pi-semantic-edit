// --- Tool input schema — the model-facing contract (SPEC D1) ---
// --- Primary shape: built-in edit schema + optional per-edit replaceAll; aider patch deprecated, NOT in schema ---

import { Type, type Static } from 'typebox';

const replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      'Exact text for one targeted replacement. It must be unique in the original file unless replaceAll is set, and must not overlap with any other edits[].oldText in the same call.',
  }),
  newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
  replaceAll: Type.Optional(
    Type.Boolean({
      description:
        'Replace every occurrence of the matched text instead of failing on ambiguity (rename-everywhere edits). Default false.',
    }),
  ),
});

export const editToolSchema = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  edits: Type.Array(replaceEditSchema, {
    description:
      'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
  }),
});

export type EditToolInput = Static<typeof editToolSchema>;
