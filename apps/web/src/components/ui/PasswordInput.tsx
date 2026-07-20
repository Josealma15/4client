import { useState, InputHTMLAttributes, CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  wrapperStyle?: CSSProperties;
}

// Same look as a plain password <input> (className/style still land on the input
// itself) with an eye toggle to show/hide the value - just wraps it in a relative
// positioned box so the button can sit inside the field.
export default function PasswordInput({ wrapperStyle, style, ...props }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative', ...wrapperStyle }}>
      <input {...props} type={show ? 'text' : 'password'} style={{ ...style, width: '100%', paddingRight: 36, boxSizing: 'border-box' }} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gt)',
          padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}
