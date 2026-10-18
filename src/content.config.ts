import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One file per case and language: src/content/cases/<lang>/<slug>.mdx
// The slug (file name) must match between languages so the switcher can link them.
const cases = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/cases' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),            // one line on the card and under the case title
    year: z.number(),
    role: z.string(),               // what I did
    kind: z.string(),               // tag on the card: «UX/UI», «Лендинг», «CRO-аудит»
    result: z.object({ value: z.string(), label: z.string() }).optional(), // big number on the card
    outcome: z.string().optional(), // used when there is no number
    tone: z.enum(['paper', 'ink', 'mint']).default('paper'), // card backdrop
    cover: z.string().optional(),   // path in /public, e.g. /cases/<slug>/cover.webp
    focus: z.string().default('50% 50%'), // which part of the cover the square card crop keeps (object-position)
    link: z.string().url().optional(),
    order: z.number().default(100),
    draft: z.boolean().default(false),
  }),
});

export const collections = { cases };
