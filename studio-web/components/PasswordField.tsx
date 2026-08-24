'use client';

// Password input with an eye toggle, so people can check what they typed
// before submitting.
//
// The web counterpart of `PasswordField` in src/ui/components.tsx, matching its
// behaviour and its spoken labels: the same eye and eye-off marks, and the
// button announcing itself as "Show password" / "Hide password" rather than as
// an unnamed control. Every password input on the web must use this — a masked
// field with no way to reveal it is how people get locked out of their own
// account over a typo.
import { useId, useState } from 'react';

export function PasswordField({
  value,
  onChange,
  label,
  autoComplete = 'current-password',
  required,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete?: 'current-password' | 'new-password';
  required?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <>
      <label className="micro" htmlFor={id}>{label}</label>
      <div style={{ position: 'relative', margin: '6px 0 18px' }}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required={required}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 44px 10px 12px',
            borderRadius: 7,
            fontSize: 14,
            background: 'var(--surface2)',
            color: 'var(--ink)',
            border: '1px solid var(--ring)',
            fontFamily: 'var(--sans)',
          }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute',
            right: 4,
            top: 0,
            bottom: 0,
            width: 38,
            display: 'grid',
            placeItems: 'center',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink3)',
            padding: 0,
          }}
        >
          <EyeIcon off={visible} />
        </button>
      </div>
    </>
  );
}

/** The same two marks the app uses: an open eye to reveal, a struck-through eye
 *  once it is showing. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"
         stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="3.2" />
      {off ? <path d="M3.2 3.2 20.8 20.8" /> : null}
    </svg>
  );
}
