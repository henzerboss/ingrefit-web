-- Run once before rolling out the Premium alternatives UI. CONCURRENTLY avoids blocking normal OFF lookups.
-- The API checks for this exact index name and falls back to recent ProductCache
-- rows if the index has not been created yet, so deployment order is safe.
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_categories_tags_gin
ON "OffProduct" USING GIN ((data->'categories_tags'));

-- Market availability gate for recommendations. Existing mirrors need
-- `node scripts/import-openfoodfacts.mjs --backfill-countries` first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_countries_tags_gin
ON "OffProduct" USING GIN ((data->'countries_tags'));
