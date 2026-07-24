import fs from 'node:fs';
import path from 'node:path';

export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const filePath = path.join(process.cwd(), 'prompts', `${name}.md`);
  let text = fs.readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(`{{ ${key} }}`).join(value);
  }
  return text;
}
