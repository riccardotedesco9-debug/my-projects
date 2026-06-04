import {useEffect, useState, type CSSProperties} from 'react';

const KEY = 'pc-cookie-consent';

/** Lightweight, headless-friendly GDPR cookie-consent banner (no theme app). */
export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      // localStorage unavailable — skip
    }
  }, []);

  if (!show) return null;

  const decide = (value: 'accepted' | 'declined') => {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div role="dialog" aria-label="Cookie consent" style={wrap}>
      <span style={{flex: '1 1 280px', fontSize: 13}}>
        We use cookies to improve your experience. See our{' '}
        <a href="/policies/privacy-policy" style={{color: '#e0b136'}}>
          privacy policy
        </a>
        .
      </span>
      <button type="button" onClick={() => decide('declined')} style={ghost}>
        Decline
      </button>
      <button type="button" onClick={() => decide('accepted')} style={solid}>
        Accept
      </button>
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'fixed',
  left: 16,
  right: 16,
  bottom: 16,
  zIndex: 60,
  maxWidth: 720,
  margin: '0 auto',
  background: '#243673',
  color: '#fff',
  borderRadius: 16,
  padding: '14px 18px',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
  fontFamily: 'Montserrat, sans-serif',
};
const solid: CSSProperties = {
  background: '#e0b136',
  color: '#243673',
  border: 'none',
  borderRadius: 999,
  padding: '9px 18px',
  fontWeight: 800,
  cursor: 'pointer',
};
const ghost: CSSProperties = {
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.4)',
  borderRadius: 999,
  padding: '9px 16px',
  fontWeight: 700,
  cursor: 'pointer',
};
