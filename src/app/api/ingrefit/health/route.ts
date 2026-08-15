import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'ingrefit-api',
    configured: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openFoodFactsUserAgent: Boolean(process.env.OPEN_FOOD_FACTS_USER_AGENT),
      revenueCat: Boolean(process.env.REVENUECAT_SECRET_API_KEY),
      expoGoPreview: Boolean(process.env.INGREFIT_EXPO_GO_PREVIEW_TOKEN),
      demoPremium: process.env.INGREFIT_ALLOW_DEMO_PREMIUM === 'true',
    },
  });
}
