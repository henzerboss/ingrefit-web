import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isAdmin } from '@/lib/ingrefit/admin';
import { safeDb } from '@/lib/ingrefit/db';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

/** Columns the list can be ordered by. Anything else falls back to newest first. */
const SORTS = {
  created: { createdAt: 'desc' },
  updated: { updatedAt: 'desc' },
  name: { name: 'asc' },
  brands: { brands: 'asc' },
  views: { views: 'desc' },
  confidence: { confidence: 'asc' },
} as const;

type SortKey = keyof typeof SORTS;

interface Row {
  barcode: string;
  name: string | null;
  brands: string | null;
  status: string;
  confidence: number;
  views: number;
  createdAt: Date;
  imagePath: string | null;
  data: unknown;
}

function tagList(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : '';
}

const cell: React.CSSProperties = { borderBottom: '1px solid #E4E8E1', padding: '10px 8px', verticalAlign: 'top' };
const input: React.CSSProperties = { border: '1px solid #CFD8CB', borderRadius: 6, padding: 6, width: '100%' };

export default async function CommunityAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string; status?: string; page?: string; edit?: string }>;
}) {
  if (!(await isAdmin())) redirect('/admin');
  const params = await searchParams;
  const sort = (params.sort && params.sort in SORTS ? params.sort : 'created') as SortKey;
  const query = (params.q ?? '').trim();
  const status = params.status ?? 'all';
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  const where = {
    ...(status === 'all' ? {} : { status }),
    ...(query
      ? {
          OR: [
            { barcode: { contains: query } },
            { name: { contains: query, mode: 'insensitive' as const } },
            { brands: { contains: query, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const result = await safeDb(async (db) => ({
    rows: (await db.communityProduct.findMany({
      where,
      orderBy: SORTS[sort],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    })) as Row[],
    total: await db.communityProduct.count({ where }),
  }));

  if (!result) return <p>Database unavailable.</p>;
  const { rows, total } = result;
  const back = `/admin/community?sort=${sort}&status=${status}&page=${page}&q=${encodeURIComponent(query)}`;

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
          <label htmlFor="status" style={{ display: 'block', fontSize: 12 }}>
            Status
          </label>
          <select defaultValue={status} id="status" name="status" style={input}>
            <option value="all">all</option>
            <option value="published">published</option>
            <option value="pending">pending</option>
            <option value="hidden">hidden</option>
          </select>
        </div>
        <div>
          <label htmlFor="sort" style={{ display: 'block', fontSize: 12 }}>
            Sort
          </label>
          <select defaultValue={sort} id="sort" name="sort" style={input}>
            <option value="created">newest</option>
            <option value="updated">recently updated</option>
            <option value="views">most viewed</option>
            <option value="confidence">lowest confidence</option>
            <option value="name">name</option>
            <option value="brands">brand</option>
          </select>
        </div>
        <button style={{ borderRadius: 6, padding: '8px 14px' }} type="submit">
          Apply
        </button>
        <span style={{ color: '#5A6656', fontSize: 13 }}>{total} record(s)</span>
      </form>

      <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th style={cell}>Photo</th>
            <th style={cell}>Barcode</th>
            <th style={cell}>Product</th>
            <th style={cell}>Categories / markets</th>
            <th style={cell}>Status</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const record = (row.data ?? {}) as Record<string, unknown>;
            const editing = params.edit === row.barcode;
            return (
              <tr key={row.barcode}>
                <td style={cell}>
                  {row.imagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      height={52}
                      src={`/api/ingrefit/community-image/${row.barcode}`}
                      style={{ borderRadius: 6, objectFit: 'cover' }}
                      width={52}
                    />
                  ) : (
                    <span style={{ color: '#8A9487' }}>—</span>
                  )}
                </td>
                <td style={cell}>
                  <code>{row.barcode}</code>
                  <div style={{ color: '#5A6656' }}>
                    {row.views} views · confidence {Math.round(row.confidence * 100)}%
                  </div>
                  <div style={{ color: '#8A9487' }}>{row.createdAt.toISOString().slice(0, 10)}</div>
                </td>
                {editing ? (
                  <td colSpan={3} style={cell}>
                    <form action="/api/admin/community" method="post" style={{ display: 'grid', gap: 8 }}>
                      <input name="barcode" type="hidden" value={row.barcode} />
                      <input name="action" type="hidden" value="save" />
                      <input name="back" type="hidden" value={back} />
                      <input
                        defaultValue={String(record.product_name ?? '')}
                        name="name"
                        placeholder="Name"
                        style={input}
                      />
                      <input
                        defaultValue={String(record.brands ?? '')}
                        name="brands"
                        placeholder="Brand"
                        style={input}
                      />
                      <textarea
                        defaultValue={String(record.ingredients_text ?? '')}
                        name="ingredients_text"
                        placeholder="Ingredients"
                        rows={3}
                        style={input}
                      />
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
                        <button type="submit">Save</button>
                        <Link href={back}>Cancel</Link>
                      </div>
                    </form>
                  </td>
                ) : (
                  <>
                    <td style={cell}>
                      <strong>{row.name ?? '—'}</strong>
                      <div style={{ color: '#5A6656' }}>{row.brands ?? ''}</div>
                      <div style={{ color: '#8A9487', maxWidth: 320 }}>
                        {String(record.ingredients_text ?? '').slice(0, 120)}
                      </div>
                    </td>
                    <td style={cell}>
                      <div>
                        {tagList(record.categories_tags) || <span style={{ color: '#B4402F' }}>no category</span>}
                      </div>
                      <div style={{ color: '#5A6656' }}>{tagList(record.countries_tags) || 'no market'}</div>
                      <div style={{ color: '#8A9487' }}>
                        Nutri-Score {String(record.nutriscore_grade ?? '—').toUpperCase()} · NOVA{' '}
                        {String(record.nova_group ?? '—')}
                      </div>
                    </td>
                    <td style={cell}>{row.status}</td>
                  </>
                )}
                <td style={cell}>
                  {editing ? null : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <Link href={`${back}&edit=${row.barcode}`}>Edit</Link>
                      <form action="/api/admin/community" method="post">
                        <input name="barcode" type="hidden" value={row.barcode} />
                        <input name="back" type="hidden" value={back} />
                        <input name="action" type="hidden" value={row.status === 'published' ? 'hide' : 'publish'} />
                        <button type="submit">{row.status === 'published' ? 'Hide' : 'Publish'}</button>
                      </form>
                      <form action="/api/admin/community" method="post">
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
        {page > 1 ? (
          <Link href={`/admin/community?sort=${sort}&status=${status}&q=${query}&page=${page - 1}`}>Previous</Link>
        ) : null}
        {page * PAGE_SIZE < total ? (
          <Link href={`/admin/community?sort=${sort}&status=${status}&q=${query}&page=${page + 1}`}>Next</Link>
        ) : null}
      </div>
    </>
  );
}
