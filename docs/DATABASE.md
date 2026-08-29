# Database and Open Food Facts self-hosting


## Installation identity

`Installation` stores one row per device: the id the app generates at first
launch and the secret it registered with. It is the only table that is not a
cache — losing it does not lose user data, but every device has to re-register
before it can prove possession of its id again, and until it does it is served
as `free` when `INGREFIT_REQUIRE_INSTALLATION_PROOF=true`.

Nothing else changes: there is still no user account, no scan history and no
photo stored server-side.

Prune abandoned rows with, for example:

```sql
DELETE FROM "Installation" WHERE "lastSeenAt" < now() - interval '18 months';
```

## Why PostgreSQL

The backend now needs persistence for four things: cached product records,
cached translations, cached explanations and rate-limit counters. PostgreSQL was
chosen because it matches the existing evsi.store stack (Prisma, same operational
tooling), it handles the `Json` columns these caches need, and — most
importantly — the same instance can later hold the full Open Food Facts dataset
without introducing a second database technology.

Everything stored server-side is a cache or a counter. There is no user account,
no scan history and no photo. Dropping the entire database costs money in
re-generated Gemini calls and nothing else.

```bash
npm run db:push      # create the schema
npm run db:generate  # regenerate the Prisma client
```

## Can the whole Open Food Facts database live on your own server?

Yes. Open Food Facts publishes complete exports specifically for this, and the
code already supports it: set `OPEN_FOOD_FACTS_LOCAL=true` and barcode lookups
read the `OffProduct` table instead of calling the public API.

This is worth doing sooner rather than later, because the public API rate-limits
product reads per IP address, and every request from this backend leaves from a
single IP. A local mirror removes that ceiling from the critical path entirely
and makes a cold-cache scan a local index lookup instead of a network round trip.

### Size

The raw JSONL export is roughly 50 GB uncompressed and contains hundreds of
fields per product. The importer keeps only the fields the app reads (identity,
ingredients, tags, the nutrients used by the scorer), which brings the stored
size down by more than an order of magnitude. Budget tens of gigabytes for the
table plus its index, not hundreds.

Since 1.11 that set also includes `product_name_<lang>` and
`ingredients_text_<lang>` for all 49 supported Open Food Facts languages. A
product carries variants only for the languages actually printed on its
package — typically two or three — and the importer drops any variant that
merely repeats the default `ingredients_text`, which is what Open Food Facts
usually stores for the package's own language. The practical cost is a few
hundred bytes per row.

It buys a lot: a user scanning a product printed in their own language now
reads it straight from the mirror instead of having a Gemini translation
bought for them, and free-tier users get localized text at all.

### Backfilling localized fields

A mirror imported before 1.11 has only the Russian and English variants. Fill
in the rest without a full re-import:

```bash
./scripts/off-cron.sh backfill-languages
```

or directly:

```bash
node scripts/import-openfoodfacts.mjs --backfill-languages
```

It reuses the archive already in `OFF_IMPORT_DIR`, merges only the localized
keys into each row (`data || input`), leaves nutrition, tags, images and
timestamps untouched, and is resumable from a state file like the other
backfills. Expect a few hours for a full pass.

### First import

Run it through the wrapper, which loads `.env` and resolves node the same way
the cron job will:

```bash
mkdir -p "$OFF_IMPORT_DIR" "$OFF_LOG_DIR"
nohup ./scripts/off-cron.sh full > /dev/null 2>&1 &
```

It downloads the export to `OFF_IMPORT_DIR`, streams it, and upserts in batches
of 2,000 inside transactions. Expect hours, not minutes, so start it detached —
an SSH disconnect must not kill it. The run is restartable: progress is written
to a state file, so an interrupted import resumes at the line it stopped on
rather than starting over.

Budget disk space before starting: the compressed download plus the resulting
table need roughly 60–70 GB combined. Check with `df -h`.

### Keeping it current, safely

Point the server's cron at `scripts/off-cron.sh`. Do not call
`import-openfoodfacts.mjs` from cron directly: cron provides a minimal `PATH`
(so an nvm-installed node is not found) and does not load `.env` (so
`DATABASE_URL` would be missing). The wrapper handles both, takes an flock so a
slow night cannot start a second overlapping import, and prunes expired
rate-limit rows afterwards.

```cron
# Nightly deltas at 04:15
15 4 * * * /home/ingrefit/htdocs/ingrefit.com/scripts/off-cron.sh
```

In a panel with separate schedule fields: minute `15`, hour `4`, day `*`,
month `*`, weekday `*`, command `/home/ingrefit/htdocs/ingrefit.com/scripts/off-cron.sh`.

Logs land in `$OFF_LOG_DIR` (`off-delta.log`, `off-full.log`). If the log stays
empty after the first night, node was not found — set `NODE_BIN` in `.env` to
the output of `command -v node`.

Open Food Facts publishes daily delta files; a normal night is a few megabytes.
Re-run `--full` every few months to pick up deletions and any records the deltas
missed.

### Recommendation market data

`countries_tags` in Open Food Facts describes the countries where a product is
sold. The importer now retains it inside `OffProduct.data`, and live OFF cache
records request it as well. Mirrors imported by an older IngreFit importer do
not have this field because the previous whitelist discarded it.

Enrich an existing mirror once without rebuilding nutrition or images:

```bash
node scripts/import-openfoodfacts.mjs --backfill-countries
node scripts/import-openfoodfacts.mjs --backfill-nutrition-basis
psql "$DATABASE_URL" -f scripts/add-recommendation-index.sql
```

The backfill reuses `openfoodfacts-products.jsonl.gz` already stored in
`OFF_IMPORT_DIR`, is resumable through the normal import state file, and updates
only the `countries_tags` key in the existing JSON. If the archive is no longer
present it downloads the current full export once. Daily `--delta` imports keep
this field current afterwards.

The recommendation endpoint intentionally rejects candidate rows whose market is
unknown. This can temporarily reduce the number of alternatives during a
backfill, but it prevents global products from leaking into a local-market
recommendation list.


### Nutrition basis metadata

Older mirrors may contain normalized `*_100g` nutrient keys but lack the OFF metadata that tells the UI whether those values were declared per 100 g or per 100 ml. Run the one-time resumable backfill:

```bash
node scripts/import-openfoodfacts.mjs --backfill-nutrition-basis
```

It reuses the same local full OFF archive and patches only rows whose `nutrition_data_per` is currently missing, adding `nutrition_data_per` plus prepared-basis/serving metadata when available. It also recovers `100g`/`100ml` from the newer `nutrition.input_sets` structure when the legacy top-level field is missing. No Prisma migration is required.

Four properties make this safe to run unattended:

- **The table is never truncated.** Updates are upserts, so a failed run leaves
  the previous dataset intact and simply gets re-run.
- **Batched transactions.** A crash cannot leave a row half-written.
- **Applied deltas are recorded**, so a re-run does not double-apply and a
  missed night catches up automatically.
- **The application degrades rather than breaks.** With
  `OPEN_FOOD_FACTS_LOCAL_ONLY=false`, a barcode missing from the mirror falls
  through to the public API, so a stale or partial mirror is never user-visible.

Run the first import against a copy, confirm row counts and spot-check a few
barcodes, then point production at it. Take a database dump before the first
`--full` run of each new release of this script.

## What about product images?

Keep loading them from Open Food Facts. The exports contain image **URLs**, not
image files; the images themselves are a separate multi-terabyte archive that is
not worth mirroring for this use case. The app already renders
`image_front_url` directly.

Two refinements worth considering later, neither urgent:

- An image proxy on your own domain (`/api/image/<barcode>`) that fetches and
  caches the upstream file. This gives you control over caching headers, avoids
  a third-party request from the client, and lets you swap the source later
  without changing the app.
- A CDN in front of that proxy once traffic justifies it.

Until then, the API returns the Open Food Facts 200 px front-image derivative when available. The mobile app downloads it once, re-encodes it as a maximum-256 px JPEG in persistent app storage, and then renders the local thumbnail on later launches. The full upstream image is never intentionally kept as persistent app data.

## Licence obligations

The Open Food Facts database is published under the **Open Database License
(ODbL) v1.0**, and its individual contents under the Database Contents License.
Practically this means:

- **Attribute.** Say the data comes from Open Food Facts and name the licence,
  with a link, wherever product data is shown. The app and website both do this.
- **Share alike.** If you publicly redistribute a *derived database* — not
  merely display results — that derived database must be offered under ODbL too.
  Showing scores in an app is use, not redistribution; publishing your enriched
  copy of the dataset would be redistribution.
- **Keep it open.** Do not apply technical measures that restrict others from
  using the data as the licence permits.

Your own additions — the scoring engine, the additive classification, generated
explanations — are your work and are not covered by ODbL. Keep them in separate
tables from the imported dataset, which the current schema already does.

## Operational notes

- `RateLimitWindow` accumulates rows. The nightly `scripts/off-cron.sh` run
  prunes them; `./scripts/off-cron.sh prune` does it on demand. Schedule that
  cron even if the local dataset mirror is never enabled.
- `ExplanationCache` tracks `hits`; watch it after launch. A low hit rate means
  the fingerprint is too specific and the cache is not paying for itself.
- Back up `ProductLocalization` and `ExplanationCache` — losing them is not a
  correctness problem, but re-earning them costs real Gemini spend.

## Field shapes in the JSONL export

The JSONL export is the MongoDB document, not the API response. The field
reference is published at
`https://world.openfoodfacts.org/data/data-fields.txt`, and two of its rules
matter for the importer:

- `*_100g` is the amount per 100 g or 100 ml, **and energy in that family is in
  kJ**. Only `energy-kcal_100g` is in kcal, so `energy_100g` and `energy-kj_100g`
  must be divided by 4.184.
- `*_serving` is per serving, so those values cannot be reinterpreted as per
  100 g without a serving weight.

Nutrition is not stored in one place. Open Food Facts is migrating onto a newer
`nutrition.input_sets` structure, and **for products already migrated the legacy
`nutriments` object is left empty** — roughly one record in six, including
well-known products such as Nutella. The importer therefore reads three sources
in order of trustworthiness and merges them:

0. Per-serving declarations are converted using `serving_quantity`, and skipped
   entirely when that weight is unknown — an unconvertible per-serving value must
   never be recorded as if it were per 100 g.
1. `nutriments` — the legacy object. Carries `*_100g` keys, bare names (`fat`,
   `sugars`) whose basis is given by `nutrition_data_per`, and `*_value` in the
   unit named by `*_unit`.
2. `nutrition.input_sets[]` and `nutrition.aggregated_set` — the new structure. Each set has `per`,
   `per_quantity`, `per_unit` and `nutrients: { name: { value, unit,
   value_computed } }`. Only per-100 sets are used, preferring
   `source: "manufacturer"`, because a per-serving set cannot be converted
   without a serving weight.
3. `nutriscore.2021.data` and `nutriscore_data.components` — the declared values
   Open Food Facts fed into Nutri-Score. Smaller set, and the units differ:
   energy in kJ, sodium in mg in the 2021 block.

Salt is then derived from sodium (and back) at a ratio of 2.5, and the
fruit/vegetable estimate falls back to its top-level field.
`scripts/import-openfoodfacts.mjs` handles all of these and stores the raw
per-nutrient subset alongside the normalized values, so re-deriving them later is
a SQL update rather than another multi-hour pass over the archive.

### Before importing, find out where the data actually is

```bash
node scripts/import-openfoodfacts.mjs --discover 200000   # quick look
node scripts/import-openfoodfacts.mjs --discover          # whole archive
```

`--discover` scans records the importer FAILS to extract from and reports which
fields still hold something and what shape they have, ranked by how much of the
dataset each accounts for. Open Food Facts is actively migrating its schema —
nutrition moved to `nutrition.input_sets`, images to `images.selected.front` —
and each unnoticed move silently emptied a large slice of the mirror. Run this
after every full re-download instead of discovering the next migration through a
user-visible regression.

Read the output like this: a shape with a large count is an unsupported
structure worth adding to the importer; `missing` and `object(empty)` mean the
data is genuinely absent upstream and no code change will recover it.

Two further checks, both cheap:

```bash
node scripts/import-openfoodfacts.mjs --stats                   # exact, full pass, several minutes
node scripts/import-openfoodfacts.mjs --stats 50000             # quick smoke test, biased
node scripts/import-openfoodfacts.mjs --inspect 3017620422003   # what does one product look like?
```

`--stats` with no argument reads the whole archive and reports exact figures.
**Do not trust a head sample as a statistic:** the archive is not randomly
ordered, and a 50,000-line sample once read 96% usable where the complete
dataset was 72%. Passing a line count is a smoke test for "is this download
readable at all", nothing more.

Expect roughly a quarter of the dataset to carry no usable nutrition at all.
Many products in Open Food Facts have never had a nutrition table entered, which
is a property of crowdsourced data, not a defect in the import. A published archive
can contain records whose `nutriments` is empty even though the API serves full
values for the same barcode, so a bad download is worth catching before spending
hours on it.

Because of that, **a thin mirror row counts as a miss**: if the local record
cannot support a score, the lookup falls through to the API (unless
`OPEN_FOOD_FACTS_LOCAL_ONLY=true`), and the thin row is only used if the network
then fails. The mirror can therefore never make results worse than the API alone,
which is why `LOCAL_ONLY` should stay `false` unless the mirror is known good.

Two further consequences of using the exports:

- **Delta files cannot express deletions.** Only a full re-import removes
  products that were deleted upstream, which is why `--full` should still run
  every few months.
- **Product images are licensed CC BY-SA**, separately from the ODbL database.
  Attribution applies to images too if they are displayed.

## Product images

`image_front_url` and `image_front_small_url` are computed fields the API adds on
the fly; the raw export carries only the `images` object. The importer therefore
reconstructs the URLs from the image revision:

```
https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg
                                                 ^ code split 3/3/3/rest        ^ rev
```

Codes of nine digits or more are padded to 13 and split 3/3/3/rest; shorter codes
are used as-is. The front image is chosen in the product's own language first,
then English, then any available front image.

Like nutrition, this field exists in two shapes, and only supporting the legacy
one yielded an image for fewer than a fifth of the dataset:

```
legacy: images["front_fr"]        = { rev, sizes }
new:    images.selected.front.fr  = { rev, imgid, sizes }
```

`--inspect <barcode>` prints the raw `images` object and the derived URLs, which
is the fastest way to check a product that shows no picture. A mirror imported before this was
added has no images at all — that requires a re-import, not a code change.

Images are licensed CC BY-SA, separately from the ODbL database, so attribution
applies to them too.

## Translating assessment output

Product assessment wording lives in `src/lib/ingrefit/catalog/<language>.json`,
not in TypeScript. To add a language: copy `en.json`, translate the values while
keeping every `{placeholder}` intact, then import it in
`src/lib/ingrefit/catalog/index.ts` and add it to `CATALOGS`. Missing keys fall
back to English individually, so partial files are safe to ship.

`npm run i18n:status` reports completeness for both the website UI and the
assessment catalog; add `--missing` to list the outstanding keys.
