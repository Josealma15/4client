import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';

const DB_TABLES = ['users', 'organizations', 'products', 'employees', 'orders', 'tickets', 'ticket_messages', 'order_history', 'daily_closes'];

export default function DevDbPanel() {
  const [table, setTable] = useState('users');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const limit = 20;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dev-db', table, offset],
    queryFn: () => api.get<{ data: any[]; total: number }>(`/dev/db?table=${table}&limit=${limit}&offset=${offset}`).then(r => r),
    staleTime: 0,
  });

  const allRows: any[] = (data as any)?.data ?? [];
  const rows = search
    ? allRows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(search.toLowerCase())))
    : allRows;
  const total: number = (data as any)?.total ?? 0;
  const cols = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const SECRET_COLS = new Set(['password_hash', 'token_hash', 'wpp_meta_token', 'wpp_meta_app_secret']);

  function fmtVal(col: string, val: any): string {
    if (val === null || val === undefined) return '—';
    if (SECRET_COLS.has(col)) return '••••••••';
    if (typeof val === 'boolean') return val ? 'Sí' : 'No';
    const s = String(val);
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="fi"
          style={{ width: 'auto', padding: '7px 12px', fontSize: 13 }}
          value={table}
          onChange={e => { setTable(e.target.value); setOffset(0); setSearch(''); }}>
          {DB_TABLES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className="fi"
          style={{ width: 180, padding: '7px 12px', fontSize: 13 }}
          placeholder="Filtrar filas..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="bsec" style={{ padding: '7px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }} onClick={() => refetch()}>
          <RotateCcw size={12} />{isFetching ? 'Cargando...' : 'Refrescar'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {search ? `${rows.length} de ${allRows.length} filas (${total} total)` : `${total} filas totales`}
        </span>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--gt)', padding: 16 }}>Cargando...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--gt)', padding: 16, fontSize: 13 }}>Sin datos en esta tabla.</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--brd)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ background: 'var(--gm)' }}>
                {cols.map(c => (
                  <th key={c} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--gt)', borderBottom: '1px solid var(--brd)', whiteSpace: 'nowrap' }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--brd)', background: i % 2 === 0 ? 'var(--b)' : 'var(--bg)' }}>
                  {cols.map(c => {
                    const display = fmtVal(c, row[c]);
                    const isSecret = SECRET_COLS.has(c);
                    return (
                      <td
                        key={c}
                        title={isSecret ? '(oculto)' : String(row[c] ?? '')}
                        style={{ padding: '7px 12px', color: isSecret ? 'var(--gt)' : 'var(--n)', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          <ChevronRight size={12} style={{ transform: 'rotate(180deg)' }} /> Anterior
        </button>
        <span style={{ fontSize: 12, color: 'var(--gt)' }}>
          {rows.length > 0 ? `${offset + 1}–${offset + rows.length} de ${total}` : '0 resultados'}
        </span>
        <button className="bsec" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          disabled={rows.length < limit} onClick={() => setOffset(offset + limit)}>
          Siguiente <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
