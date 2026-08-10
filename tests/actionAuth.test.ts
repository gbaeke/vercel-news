import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ACTION_FILES = [
  'app/review/actions.ts',
  'app/review/[id]/actions.ts',
  'app/review/settings/actions.ts',
];

describe('review Server Action authorization boundary', () => {
  it.each(ACTION_FILES)('%s authenticates every exported action before doing work', (relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const declarations = [...source.matchAll(/export async function\s+(\w+)\s*\([^)]*\)\s*\{/g)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      const bodyStart = (declaration.index ?? 0) + declaration[0].length;
      expect(source.slice(bodyStart, bodyStart + 120).trimStart()).toMatch(
        /^await requireReviewSession\(\);/
      );
    }
  });
});
