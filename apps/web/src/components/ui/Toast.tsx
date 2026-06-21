import { useEffect, useState } from 'react';

let _show: ((msg: string, err?: boolean) => void) | null = null;

export function toast(msg: string, err = false) {
  _show?.(msg, err);
}

export default function Toast() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    _show = (m, e = false) => {
      setMsg(m);
      setErr(e);
      setVisible(true);
      setTimeout(() => setVisible(false), 2800);
    };
    return () => { _show = null; };
  }, []);

  if (!visible) return null;
  return (
    <div className="toast" style={{ background: err ? 'var(--r)' : 'var(--vd)' }}>
      {msg}
    </div>
  );
}
