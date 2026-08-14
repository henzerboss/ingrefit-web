import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'ingrefit-api',
    configured: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openFoodFactsUserAgent: Boolean(process.env.OPEN_FOOD_FACTS_USER_AGENT),
      durableQuota: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    },
  });
}
