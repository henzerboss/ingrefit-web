-- Run once before rolling out the Premium alternatives UI. CONCURRENTLY avoids blocking normal OFF lookups.
-- The API checks for this exact index name and falls back to recent ProductCache
-- rows if the index has not been created yet, so deployment order is safe.
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_categories_tags_gin
ON "OffProduct" USING GIN ((data->'categories_tags'));

-- Market availability gate for recommendations. Existing mirrors need
-- `node scripts/import-openfoodfacts.mjs --backfill-countries` first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS off_product_countries_tags_gin
ON "OffProduct" USING GIN ((data->'countries_tags'));

-- Same two gates for the network/cache table. Without these the API had to read
-- the 400 most recently refreshed rows and discard almost all of them after a
-- full deserialize, which is the single most expensive thing a recommendation
-- request used to do.
CREATE INDEX CONCURRENTLY IF NOT EXISTS product_cache_categories_tags_gin
ON "ProductCache" USING GIN ((facts->'categories_tags'));

CREATE INDEX CONCURRENTLY IF NOT EXISTS product_cache_countries_tags_gin
ON "ProductCache" USING GIN ((facts->'countries_tags'));
