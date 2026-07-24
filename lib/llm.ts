import { generateText, generateObject, generateImage, jsonSchema } from 'ai';

// All model access goes through the Vercel AI Gateway: model ids are plain
// "provider/model" strings and auth is the project's OIDC token (auto-set on
// Vercel; refresh locally with `vercel env pull`). No provider API keys.

function isFake(): boolean {
  return process.env.FAKE_LLM === '1';
}

function textModel(): string {
  return process.env.TEXT_MODEL ?? 'deepseek/deepseek-v4-flash';
}

export async function complete(system: string, user: string): Promise<string> {
  if (isFake()) {
    return `[FAKE] response to a ${user.length}-character prompt under system: ${system.slice(0, 40)}`;
  }
  const { text } = await generateText({ model: textModel(), system, prompt: user });
  return text;
}

function fakeValueForSchema(schema: any): any {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'boolean':
      return true;
    case 'integer':
    case 'number':
      return 1;
    case 'array':
      return [];
    case 'object': {
      const obj: Record<string, any> = {};
      for (const key of Object.keys(schema.properties ?? {})) {
        obj[key] = fakeValueForSchema(schema.properties[key]);
      }
      return obj;
    }
    default:
      return 'fake';
  }
}

// jsonSchema() alone does not deep-validate the model's output at runtime, and
// some models occasionally invent their own property names. Check required
// keys ourselves and retry once before giving up.
function hasRequiredKeys(obj: any, schema: any): boolean {
  if (obj == null) return false;
  if (schema.type === 'object' && Array.isArray(schema.required)) {
    return schema.required.every((key: string) => key in obj);
  }
  return true;
}

export async function structured<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  if (isFake()) {
    return fakeValueForSchema(schema) as T;
  }
  // Some models ignore the schema's property names unless they are spelled
  // out in the prompt itself.
  const required = Array.isArray((schema as any).required) ? (schema as any).required : [];
  const keyHint = required.length
    ? `\n\nRespond with a JSON object using exactly these property names: ${required.join(', ')}.`
    : '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { object } = await generateObject({
      model: textModel(),
      system: system + keyHint,
      prompt: user,
      schema: jsonSchema<T>(schema as any),
    });
    if (hasRequiredKeys(object, schema)) return object as T;
    console.log(`[llm] structured output missing required keys (attempt ${attempt}), got: ${Object.keys(object as object).join(',')}`);
  }
  throw new Error('structured output missing required keys after retry');
}

export async function generateImageBytes(prompt: string): Promise<Buffer> {
  if (isFake()) throw new Error('FAKE_LLM: image generation skipped');
  const model = process.env.IMAGE_MODEL ?? 'google/imagen-4.0-fast-generate-001';
  try {
    const { image } = await generateImage({ model, prompt });
    return Buffer.from(image.uint8Array);
  } catch (imageApiErr) {
    // Multimodal chat models (e.g. google/gemini-3.1-flash-image) don't speak
    // the image API; they return images as files on a text generation result.
    const result = await generateText({ model, prompt });
    const image = result.files.find((f) => f.mediaType?.startsWith('image/'));
    if (!image) throw imageApiErr;
    return Buffer.from(image.uint8Array);
  }
}
