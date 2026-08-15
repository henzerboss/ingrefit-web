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
  'heart_health',
  'steady_energy',
  'digestive_wellness',
]);

const profileSchema = z.object({
  goals: z.array(goalSchema).min(1).max(11),
  diet: z.enum(['none', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free', 'low_carb', 'mediterranean']),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30),
  avoidedIngredients: z.array(z.string().trim().min(1).max(100)).max(30),
});

const photoSchema = z.object({
  kind: z.enum(['front', 'ingredients', 'nutrition', 'food']),
  base64: z.string().min(100).max(6_000_000),
  mimeType: z.literal('image/jpeg'),
});

export const analyzeRequestSchema = z
  .object({
    barcode: z.string().regex(/^\d{8,14}$/).nullable().optional(),
    locale: z.string().trim().min(2).max(35).default('en'),
    mode: z.enum(['barcode', 'label', 'unpackaged']).default('barcode'),
    premiumFeatures: z.boolean().default(false),
    profile: profileSchema,
    photos: z.array(photoSchema).min(1).max(3).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'barcode' && (!value.barcode || value.photos)) context.addIssue({ code: 'custom', message: 'barcode mode requires only a barcode' });
    if (value.mode === 'label') {
      if (!value.photos || value.photos.length !== 3) {
        context.addIssue({ code: 'custom', message: 'label mode requires three photos' });
        return;
      }
      const kinds = new Set(value.photos.map((photo) => photo.kind));
      for (const required of ['front', 'ingredients', 'nutrition'] as const) {
        if (!kinds.has(required)) {
          context.addIssue({ code: 'custom', message: `missing ${required} photo` });
        }
      }
    }
    if (value.mode === 'unpackaged' && (!value.photos || value.photos.length !== 1 || value.photos[0]?.kind !== 'food')) context.addIssue({ code: 'custom', message: 'unpackaged mode requires one food photo' });
  });

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
