import { Type, type Static } from 'typebox';

const replaceEditSchema = Type.Object({
  oldText: Type.String({
    description:
      'Exact replacement text, unique unless replaceAll: true; no overlap with other edits[] in the same call.',
  }),
  newText: Type.String({ description: 'Replacement text.' }),
  replaceAll: Type.Optional(
    Type.Boolean({
      description: 'Replace every occurrence (renames).',
    }),
  ),
});

const singleEditSchema = Type.Object({
  oldText: Type.String(),
  newText: Type.String(),
  replaceAll: Type.Optional(Type.Boolean()),
});

export const editToolSchema = Type.Object({
  path: Type.String({ description: 'File to edit (relative or absolute)' }),
  edits: Type.Union([
    Type.Array(replaceEditSchema, {
      description:
        'Targeted replacements, matched against the original file; no overlapping or nested edits; merge nearby changes.',
    }),
    singleEditSchema,
    Type.String({ description: 'Edits as a JSON string.' }),
  ]),
});

export type EditToolInput = Static<typeof editToolSchema>;
