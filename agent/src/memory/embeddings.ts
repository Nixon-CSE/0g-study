import { embed } from 'ai';
import type { EmbeddingModel } from 'ai';

export async function embedText(model: EmbeddingModel<string>, text: string): Promise<Float32Array> {
  const { embedding } = await embed({ model, value: text });
  return Float32Array.from(embedding);
}
