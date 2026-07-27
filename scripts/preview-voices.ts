import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { generateSpeechBytes } from '../lib/llm';

dotenv.config({ path: '.env.local' });

const voices = ['alloy', 'nova', 'onyx'];
const sample = process.argv.slice(2).join(' ').trim() ||
  'The AI Wire. This article is narrated by an AI-generated voice. Here is today’s dispatch.';

async function main() {
  if (process.env.FAKE_LLM === '1') {
    throw new Error('Voice previews require real AI Gateway access; set FAKE_LLM=0.');
  }

  const outputDir = path.join(process.cwd(), 'voice-previews');
  await fs.mkdir(outputDir, { recursive: true });

  for (const voice of voices) {
    process.stdout.write(`Generating ${voice}… `);
    const bytes = await generateSpeechBytes(sample, voice);
    const output = path.join(outputDir, `${voice}.mp3`);
    await fs.writeFile(output, bytes);
    process.stdout.write(`${output} (${bytes.length} bytes)\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
