'use client';

// The table primitive.
//
// Forty screens of this console are a list of rows someone scans, sorts and
// exports. Building that once means the sorting rule, the empty state and the
// treatment of a missing value are decided in one place — and "missing" renders
// as a dash rather than a zero, because a gym with no recorded sessions and a
// gym with zero sessions are different facts.
import { useMemo, useState } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  /** Value used for sorting and, unless `render` says otherwise, display. */
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  /** Right-aligned figures line up only with tabular numerals. */
  numeric?: boolean;
}

export function DataTable<T>({
  rows,
  columns,
  empty,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  empty: React.ReactNode;
  rowKey: (row: T) => string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [desc, setDesc] = useState(true);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const av = col.value(a), bv = col.value(b);
      // Missing values sort last whichever way the column is pointing: an
      // unknown is not a small number.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    });
  }, [rows, columns, sortKey, desc]);

  if (!rows.length) {
    return <div style={{ padding: '22px 12px', color: 'var(--ink3)', fontSize: 12.5 }}>{empty}</div>;
  }

  const toggle = (key: string) => {
    if (sortKey === key) setDesc((d) => !d);
    else { setSortKey(key); setDesc(true); }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                title={`Sort by ${c.header}`}
                style={{
                  textAlign: c.align ?? (c.numeric ? 'right' : 'left'),
                  padding: '5px 12px',
                  borderBottom: '1px solid var(--ring)',
                  color: sortKey === c.key ? 'var(--ink)' : 'var(--ink3)',
                  fontFamily: 'var(--mono)',
                  fontSize: 8,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.header}
                {sortKey === c.key ? <span style={{ marginLeft: 5 }}>{desc ? '▾' : '▴'}</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => {
                const v = c.value(row);
                const missing = v == null || v === '';
                return (
                  <td
                    key={c.key}
                    style={{
                      textAlign: c.align ?? (c.numeric ? 'right' : 'left'),
                      padding: '6px 12px',
                      borderBottom: '1px solid var(--ring2)',
                      color: missing ? 'var(--ink3)' : 'var(--ink2)',
                      fontFamily: c.numeric ? 'var(--mono)' : 'var(--sans)',
                      fontVariantNumeric: c.numeric ? 'tabular-nums' : undefined,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.render ? c.render(row) : missing ? '—' : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
