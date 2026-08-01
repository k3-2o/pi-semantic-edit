// Tool input schema — the model-facing contract. ONE field: `patch`, in exact
// aider SEARCH/REPLACE block format. No path/edits/anchor/replace_all (SPEC D1).

import { Type, type Static } from 'typebox';

export const editToolSchema = Type.Object({
  patch: Type.String({
    description:
      'Aider-format SEARCH/REPLACE patch. Each block: the file path on its own line, ' +
      'then a fenced (```) block containing <<<<<<< SEARCH, the exact code to find, ' +
      '=======, the replacement code, and >>>>>>> REPLACE. Multiple blocks may appear ' +
      'in one patch. Example:\n' +
      'src/foo.ts\n' +
      '```\n' +
      '<<<<<<< SEARCH\n' +
      'old code here\n' +
      '=======\n' +
      'new code here\n' +
      '>>>>>>> REPLACE\n' +
      '```',
  }),
});

export type EditToolInput = Static<typeof editToolSchema>;
