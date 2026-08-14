import { z } from 'zod';

const goalSchema = z.enum([
  'balanced',
  'weight_loss',
  'muscle_gain',
  'high_protein',
  'low_sugar',
  'low_sodium',
  'high_fiber',
  'minimally_processed',
]);

const profileSchema = z.object({
  goals: z.array(goalSchema).min(1).max(8),
  diet: z.enum(['none', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free']),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30),
  avoidedIngredients: z.array(z.string().trim().min(1).max(100)).max(30),
});

const photoSchema = z.object({
  kind: z.enum(['front', 'ingredients', 'nutrition']),
  base64: z.string().min(100).max(6_000_000),
  mimeType: z.literal('image/jpeg'),
});

export const analyzeRequestSchema = z
  .object({
    barcode: z.string().regex(/^\d{8,14}$/).nullable().optional(),
    locale: z.string().trim().min(2).max(35).default('en'),
    profile: profileSchema,
    photos: z.array(photoSchema).min(3).max(3).optional(),
  })
  .superRefine((value, context) => {
    if (!value.barcode && !value.photos) {
      context.addIssue({ code: 'custom', message: 'barcode or photos is required' });
    }
    if (value.photos) {
      const kinds = new Set(value.photos.map((photo) => photo.kind));
      for (const required of ['front', 'ingredients', 'nutrition']) {
        if (!kinds.has(required as 'front')) {
          context.addIssue({ code: 'custom', message: `missing ${required} photo` });
        }
      }
    }
  });

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
