import fs from 'node:fs';
import path from 'node:path';
import { load as loadYaml } from 'js-yaml';

export interface Persona {
  name: string;
  style: string;
}

export const DEFAULT_PERSONA_ID = 'pragmatic-engineer';

let cache: Persona[] | null = null;

function loadPersonas(): Persona[] {
  if (!cache) {
    const raw = fs.readFileSync(path.join(process.cwd(), 'personas.yaml'), 'utf-8');
    const parsed = loadYaml(raw) as { personas?: Persona[] };
    if (!Array.isArray(parsed.personas) || parsed.personas.length === 0) {
      throw new Error('personas.yaml must define at least one persona');
    }
    if (parsed.personas.some((persona) => !persona.name || !persona.style)) {
      throw new Error('every persona must define a name and style');
    }
    if (new Set(parsed.personas.map((persona) => persona.name)).size !== parsed.personas.length) {
      throw new Error('persona names must be unique');
    }
    cache = parsed.personas;
  }
  return cache;
}

export function getPersonas(): Persona[] {
  return loadPersonas();
}

export function findPersona(personaId: string): Persona | null {
  return loadPersonas().find((persona) => persona.name === personaId) ?? null;
}

export function resolvePersona(personaId: string | null): Persona {
  return findPersona(personaId ?? '') ??
    findPersona(DEFAULT_PERSONA_ID) ??
    loadPersonas()[0];
}
