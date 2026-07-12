import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  className?: string;
}

const WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function parseYMD(v: string): { y: number; m: number; d: number } {
  const [y, m, d] = v.split('-').map(Number);
  return { y, m, d };
}

function toYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayYMD(): string {
  const t = new Date();
  return toYMD(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// Native <input type="date"> renders its popup calendar via internal browser UI (not
// page DOM) — its "Today"/"Clear" button labels follow the browser's own interface
// language, not the page's `lang` attribute or content, so there is no way to make
// that native picker show Spanish text. This component replaces it with one we fully
// control instead of another attribute that silently doesn't do anything in Chromium.
export default function DatePickerES({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const { y, m } = parseYMD(value || todayYMD());
  const [viewY, setViewY] = useState(y);
  const [viewM, setViewM] = useState(m); // 1-12
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const { y: vy, m: vm } = parseYMD(value || todayYMD());
    setViewY(vy);
    setViewM(vm);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  function shiftMonth(delta: number) {
    let nm = viewM + delta;
    let ny = viewY;
    if (nm < 1) { nm = 12; ny -= 1; }
    if (nm > 12) { nm = 1; ny += 1; }
    setViewM(nm);
    setViewY(ny);
  }

  function pick(day: number) {
    onChange(toYMD(viewY, viewM, day));
    setOpen(false);
  }

  const label = (() => {
    if (!value) return 'Seleccionar fecha';
    const { y: vy, m: vm, d: vd } = parseYMD(value);
    const dt = new Date(vy, vm - 1, vd);
    return `${WEEKDAY_SHORT[dt.getDay()]}, ${vd} ${MONTHS_SHORT[vm - 1]} ${vy}`;
  })();

  const firstWeekday = new Date(viewY, viewM - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewY, viewM, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const today = todayYMD();

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={className ?? 'fsel'} onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <Calendar size={14} />
        {label}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
          background: 'var(--b)', border: '1px solid var(--brd)', borderRadius: 'var(--rad)',
          boxShadow: 'var(--shf)', padding: 12, width: 260,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button type="button" onClick={() => shiftMonth(-1)} title="Mes anterior"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n)', display: 'flex', padding: 4 }}>
              <ChevronLeft size={16} />
            </button>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--n)' }}>{MONTHS[viewM - 1]} {viewY}</div>
            <button type="button" onClick={() => shiftMonth(1)} title="Mes siguiente"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n)', display: 'flex', padding: 4 }}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--gt)', padding: '2px 0' }}>{w}</div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day == null) return <div key={i} />;
              const ymd = toYMD(viewY, viewM, day);
              const isSelected = ymd === value;
              const isToday = ymd === today;
              return (
                <button key={i} type="button" onClick={() => pick(day)}
                  style={{
                    aspectRatio: '1', border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontSize: 12, fontWeight: isSelected ? 800 : 600,
                    background: isSelected ? 'var(--v)' : isToday ? 'var(--vc)' : 'transparent',
                    color: isSelected ? '#fff' : isToday ? 'var(--vd)' : 'var(--n)',
                  }}>
                  {day}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', marginTop: 12, borderTop: '1px solid var(--brd)', paddingTop: 10 }}>
            <button type="button" onClick={() => { onChange(today); setOpen(false); }}
              style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 700, background: 'var(--v)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              Hoy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
