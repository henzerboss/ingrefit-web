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
  'low_saturated_fat',
]);

export const profileSchema = z.object({
  goals: z.array(goalSchema).min(1).max(12),
  diet: z.enum(['none', 'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free', 'low_carb', 'mediterranean']),
  allergens: z.array(z.string().trim().min(1).max(80)).max(30),
  avoidedIngredients: z.array(z.string().trim().min(1).max(100)).max(30),
});

const photoSchema = z.object({
  kind: z.enum(['front', 'label', 'ingredients', 'nutrition', 'food']),
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
      if (!value.photos) {
        context.addIssue({ code: 'custom', message: 'label mode requires package photos' });
        return;
      }
      // Only information-label photos carry extractable facts. The package
      // front is a preview thumbnail and must stay on the device, so a request
      // that contains nothing but a front photo is rejected. Older clients that
      // still upload a front photo remain accepted; it is simply ignored.
      const kinds = new Set(value.photos.map((photo) => photo.kind));
      const hasReadableLabel = kinds.has('label') || kinds.has('ingredients') || kinds.has('nutrition');
      if (!hasReadableLabel) {
        context.addIssue({
          code: 'custom',
          message: 'label mode requires at least one information-label photo',
        });
      }
    }
    if (value.mode === 'unpackaged' && (!value.photos || value.photos.length !== 1 || value.photos[0]?.kind !== 'food')) context.addIssue({ code: 'custom', message: 'unpackaged mode requires one food photo' });
  });

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const recommendationsRequestSchema = z.object({
  barcode: z.string().regex(/^\d{8,14}$/),
  locale: z.string().trim().min(2).max(35).default('en'),
  // Optional only for backwards compatibility with a briefly shipped/QA client;
  // missing market means an empty recommendation list, never global fallback.
  marketCountry: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()).optional(),
  profile: profileSchema,
});

export type RecommendationsRequest = z.infer<typeof recommendationsRequestSchema>;
