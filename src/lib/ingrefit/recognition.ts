import { z } from 'zod';

import { callGemini } from './gemini';
import type { LabelPhoto, NutritionFacts, ProductFacts } from './types';

const nullableNumber = z.number().finite().nonnegative().nullable();
const extractedSchema = z.object({
  name: z.string().trim().min(1).nullable(),
  brand: z.string().trim().min(1).nullable(),
  quantity: z.string().trim().min(1).nullable(),
  ingredientsText: z.string().trim().min(1).nullable(),
  ingredients: z.array(z.string().trim().min(1)).max(100),
  allergens: z.array(z.string().trim().min(1)).max(30),
  traces: z.array(z.string().trim().min(1)).max(30),
  additives: z.array(z.string().trim().min(1)).max(50),
  labels: z.array(z.string().trim().min(1)).max(30),
  nutrition: z.object({
    energyKcal100g: nullableNumber,
    protein100g: nullableNumber,
    carbohydrates100g: nullableNumber,
    sugars100g: nullableNumber,
    fat100g: nullableNumber,
    saturatedFat100g: nullableNumber,
    fiber100g: nullableNumber,
    salt100g: nullableNumber,
    sodium100g: nullableNumber,
    servingSize: z.string().trim().min(1).nullable(),
  }),
  unknownFields: z.array(z.string().trim().min(1)).max(30),
});

const responseSchema = {
  type: 'OBJECT',
  required: ['name', 'brand', 'quantity', 'ingredientsText', 'ingredients', 'allergens', 'traces', 'additives', 'labels', 'nutrition', 'unknownFields'],
  properties: {
    name: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    quantity: { type: 'STRING', nullable: true },
    ingredientsText: { type: 'STRING', nullable: true },
    ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
    allergens: { type: 'ARRAY', items: { type: 'STRING' } },
    traces: { type: 'ARRAY', items: { type: 'STRING' } },
    additives: { type: 'ARRAY', items: { type: 'STRING' } },
    labels: { type: 'ARRAY', items: { type: 'STRING' } },
    nutrition: {
      type: 'OBJECT',
      required: ['energyKcal100g', 'protein100g', 'carbohydrates100g', 'sugars100g', 'fat100g', 'saturatedFat100g', 'fiber100g', 'salt100g', 'sodium100g', 'servingSize'],
      properties: {
        energyKcal100g: { type: 'NUMBER', nullable: true },
        protein100g: { type: 'NUMBER', nullable: true },
        carbohydrates100g: { type: 'NUMBER', nullable: true },
        sugars100g: { type: 'NUMBER', nullable: true },
        fat100g: { type: 'NUMBER', nullable: true },
        saturatedFat100g: { type: 'NUMBER', nullable: true },
        fiber100g: { type: 'NUMBER', nullable: true },
        salt100g: { type: 'NUMBER', nullable: true },
        sodium100g: { type: 'NUMBER', nullable: true },
        servingSize: { type: 'STRING', nullable: true },
      },
    },
    unknownFields: { type: 'ARRAY', items: { type: 'STRING' } },
  },
} as const;

function completeness(value: { name: string | null; brand: string | null; quantity: string | null; ingredientsText: string | null; nutrition: NutritionFacts }): number {
  const checked: unknown[] = [
    value.name,
    value.brand,
    value.quantity,
    value.ingredientsText,
    value.nutrition.energyKcal100g,
    value.nutrition.protein100g,
    value.nutrition.carbohydrates100g,
    value.nutrition.sugars100g,
    value.nutrition.fat100g,
    value.nutrition.saturatedFat100g,
    value.nutrition.fiber100g,
    value.nutrition.salt100g ?? value.nutrition.sodium100g,
  ];
  return Math.round((checked.filter((item) => item !== null).length / checked.length) * 100);
}

export async function recognizeLabel(
  barcode: string | null,
  photos: LabelPhoto[],
  locale: string,
): Promise<ProductFacts> {
  const result = await callGemini({
    systemInstruction: [
      'You are a strict food-package label transcription engine for IngreFit.',
      'Extract facts only from pixels that are legible in the supplied images.',
      'Never use product knowledge, web knowledge, typical values, estimates, calculations, or assumptions to fill a field.',
      'If a value or unit is absent, cropped, ambiguous, or unreadable, return null (for scalar fields) or omit it from the relevant array.',
      'Do not infer allergens from ingredients. Put an allergen in allergens only when the package explicitly declares or emphasizes it as an allergen.',
      'Do not infer labels such as vegan, gluten-free, organic, or sugar-free unless the package explicitly prints that claim.',
      'Transcribe ingredients in the language printed on the package. Numbers must preserve the printed per-100-g values; never convert serving values into per-100-g values.',
      'Return JSON only and follow the response schema exactly.',
    ].join(' '),
    prompt: [
      `User device language tag: ${locale}. This is supplied for context only; factual transcriptions must stay in the language printed on the package.`,
      `Known barcode: ${barcode ?? 'not available'}. Do not derive product facts from the barcode itself.`,
      `The attached images are ordered as: ${photos.map((photo) => photo.kind).join(', ')}.`,
      'Read the front, full ingredient statement, explicit allergen/traces statement, and nutrition table.',
      'For unknownFields, list the important requested fields that could not be read.',
    ].join('\n'),
    responseSchema,
    images: photos.map(({ base64, mimeType }) => ({ base64, mimeType })),
    temperature: 0,
    validate: (value) => extractedSchema.parse(value),
  });

  return {
    source: 'ai_label',
    barcode,
    name: result.name,
    brand: result.brand,
    quantity: result.quantity,
    imageUrl: null,
    ingredientsText: result.ingredientsText,
    ingredients: result.ingredients,
    allergens: result.allergens,
    traces: result.traces,
    additives: result.additives,
    labels: result.labels,
    categories: [],
    nutriScore: null,
    novaGroup: null,
    nutrition: result.nutrition,
    completeness: completeness(result),
    unknownFields: result.unknownFields,
  };
}
