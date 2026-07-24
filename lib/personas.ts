import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

export interface Persona {
  name: string;
  style: string;
  tags: string[];
}

let cache: Persona[] | null = null;

function loadPersonas(): Persona[] {
  if (!cache) {
    const raw = fs.readFileSync(path.join(process.cwd(), 'personas.yaml'), 'utf-8');
    const parsed = loadYaml(raw) as { personas: Persona[] };
    cache = parsed.personas;
  }
  return cache;
}

export function pickPersona(primaryTag: string): Persona {
  const personas = loadPersonas();
  const match = personas.find((p) => p.tags.includes(primaryTag));
  return match ?? personas[0];
}
