import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isAdmin } from '@/lib/ingrefit/admin';
import { safeDb } from '@/lib/ingrefit/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

interface MirrorRow {
  barcode: string;
  data: Record<string, unknown>;
}

function tagList(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

const cell: React.CSSProperties = { borderBottom: '1px solid #E4E8E1', padding: '10px 8px', verticalAlign: 'top' };
const input: React.CSSProperties = { border: '1px solid #CFD8CB', borderRadius: 6, padding: 6, width: '100%' };

/**
 * Mirror browser.
 *
 * Filtering is raw SQL rather than Prisma's JSON filters because the useful
 * queries here are exactly the ones the recommendation engine runs — "no
 * category", "no market" — and those need `?` and `@>` against jsonb.
 *
 * The mirror has millions of rows, so there is no total count: counting a
 * filtered jsonb scan would take longer than the page is worth.
 */
export default async function OffAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string; edit?: string }>;
}) {
  if (!(await isAdmin())) redirect('/admin');
  const params = await searchParams;
  const query = (params.q ?? '').trim();
  const filter = params.filter ?? 'all';
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await safeDb(async (db) => {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query) {
      if (/^\d{6,18}$/.test(query)) {
        conditions.push(`barcode = $${values.length + 1}`);
        values.push(query);
      } else {
        conditions.push(
          `(data->>'product_name' ILIKE $${values.length + 1} OR data->>'brands' ILIKE $${values.length + 1})`,
        );
        values.push(`%${query}%`);
      }
    }
    if (filter === 'no_category') conditions.push(`NOT (data ? 'categories_tags')`);
    if (filter === 'no_market') conditions.push(`NOT (data ? 'countries_tags')`);
    if (filter === 'no_name') conditions.push(`COALESCE(data->>'product_name', '') = ''`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.$queryRawUnsafe<MirrorRow[]>(
      `SELECT barcode, data FROM "OffProduct" ${where} ORDER BY barcode LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      ...values,
    );
  });

  if (!rows) return <p>Database unavailable.</p>;
  const back = `/admin/off?filter=${filter}&page=${page}&q=${encodeURIComponent(query)}`;

  return (
    <>
      <form method="get" style={{ alignItems: 'end', display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <label htmlFor="q" style={{ display: 'block', fontSize: 12 }}>
            Barcode, name or brand
          </label>
          <input defaultValue={query} id="q" name="q" style={{ ...input, width: 260 }} />
        </div>
        <div>
          <label htmlFor="filter" style={{ display: 'block', fontSize: 12 }}>
            Show
          </label>
          <select defaultValue={filter} id="filter" name="filter" style={input}>
            <option value="all">all</option>
            <option value="no_category">missing categories</option>
            <option value="no_market">missing markets</option>
            <option value="no_name">missing name</option>
          </select>
        </div>
        <button style={{ borderRadius: 6, padding: '8px 14px' }} type="submit">
          Apply
        </button>
        <span style={{ color: '#5A6656', fontSize: 13 }}>
          Editing here fixes recommendations for one product. A later --delta import may overwrite it.
        </span>
      </form>

      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={cell}>Barcode</th>
            <th style={cell}>Product</th>
            <th style={cell}>Categories / markets</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(rows as MirrorRow[]).map((row) => {
            const record = row.data ?? {};
            const editing = params.edit === row.barcode;
            return (
              <tr key={row.barcode}>
                <td style={cell}>
                  <code>{row.barcode}</code>
                </td>
                <td style={cell}>
                  <strong>{String(record.product_name ?? '—')}</strong>
                  <div style={{ color: '#5A6656' }}>{String(record.brands ?? '')}</div>
                  <div style={{ color: '#8A9487' }}>
                    Nutri-Score {String(record.nutriscore_grade ?? '—').toUpperCase()} · NOVA{' '}
                    {String(record.nova_group ?? '—')}
                  </div>
                </td>
                {editing ? (
                  <td style={cell}>
                    <form action="/api/admin/off" method="post" style={{ display: 'grid', gap: 8 }}>
                      <input name="barcode" type="hidden" value={row.barcode} />
                      <input name="action" type="hidden" value="save" />
                      <input name="back" type="hidden" value={back} />
                      <input
                        defaultValue={tagList(record.categories_tags)}
                        name="categories_tags"
                        placeholder="en:biscuits, en:snacks"
                        style={input}
                      />
                      <input
                        defaultValue={tagList(record.countries_tags)}
                        name="countries_tags"
                        placeholder="en:spain"
                        style={input}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="submit">Save tags</button>
                        <Link href={back}>Cancel</Link>
                      </div>
                    </form>

                    <form action="/api/admin/off" method="post" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                      <input name="barcode" type="hidden" value={row.barcode} />
                      <input name="action" type="hidden" value="save-json" />
                      <input name="back" type="hidden" value={back} />
                      <label htmlFor={`json-${row.barcode}`} style={{ fontSize: 12 }}>
                        Full record — overwritten by the next --delta import
                      </label>
                      <textarea
                        defaultValue={JSON.stringify(record, null, 2)}
                        id={`json-${row.barcode}`}
                        name="json"
                        rows={16}
                        style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                      />
                      <button type="submit">Save full record</button>
                    </form>
                  </td>
                ) : (
                  <td style={cell}>
                    <div>
                      {tagList(record.categories_tags) || <span style={{ color: '#B4402F' }}>no category</span>}
                    </div>
                    <div style={{ color: '#5A6656' }}>{tagList(record.countries_tags) || 'no market'}</div>
                  </td>
                )}
                <td style={cell}>
                  {editing ? null : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <Link href={`${back}&edit=${row.barcode}`}>Edit tags</Link>
                      <form action="/api/admin/off" method="post">
                        <input name="barcode" type="hidden" value={row.barcode} />
                        <input name="back" type="hidden" value={back} />
                        <input name="action" type="hidden" value="delete" />
                        <button style={{ color: '#B4402F' }} type="submit">
                          Delete
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        {page > 1 ? <Link href={`/admin/off?filter=${filter}&q=${query}&page=${page - 1}`}>Previous</Link> : null}
        {rows.length === PAGE_SIZE ? (
          <Link href={`/admin/off?filter=${filter}&q=${query}&page=${page + 1}`}>Next</Link>
        ) : null}
      </div>
    </>
  );
}
