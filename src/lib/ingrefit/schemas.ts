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

const profileSchema = z.object({
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
      const kinds = new Set(value.photos.map((photo) => photo.kind));
      const currentTwoPhotoFlow = value.photos.length === 2 && kinds.has('front') && kinds.has('label');
      const legacyThreePhotoFlow = value.photos.length === 3
        && kinds.has('front')
        && kinds.has('ingredients')
        && kinds.has('nutrition');
      if (!currentTwoPhotoFlow && !legacyThreePhotoFlow) {
        context.addIssue({
          code: 'custom',
          message: 'label mode requires front + label photos',
        });
      }
    }
    if (value.mode === 'unpackaged' && (!value.photos || value.photos.length !== 1 || value.photos[0]?.kind !== 'food')) context.addIssue({ code: 'custom', message: 'unpackaged mode requires one food photo' });
  });

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;
