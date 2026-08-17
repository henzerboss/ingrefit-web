# Database and Open Food Facts self-hosting

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

Until then, direct URLs are correct and cost nothing.

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
