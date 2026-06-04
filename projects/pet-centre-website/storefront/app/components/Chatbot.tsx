import {useEffect, useState} from 'react';

// Crisp — France-based, EU-hosted, GDPR built-in (fits Malta/EU + EU AI Act).
// Placeholder website ID; swap for the real one from your Crisp dashboard.
const CRISP_WEBSITE_ID = 'PLACEHOLDER-CRISP-WEBSITE-ID';
const IS_PLACEHOLDER = CRISP_WEBSITE_ID.startsWith('PLACEHOLDER');

/**
 * Site-wide chat. With a real Crisp ID it loads the managed Crisp widget;
 * until then it shows a branded placeholder bubble so the layout is complete.
 */
export function Chatbot() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (IS_PLACEHOLDER) return;
    (window as unknown as {$crisp: unknown[]}).$crisp = [];
    (window as unknown as {CRISP_WEBSITE_ID: string}).CRISP_WEBSITE_ID =
      CRISP_WEBSITE_ID;
    const s = document.createElement('script');
    s.src = 'https://client.crisp.chat/l.js';
    s.async = true;
    document.head.appendChild(s);
  }, []);

  // The real Crisp widget renders its own bubble.
  if (!IS_PLACEHOLDER) return null;

  return (
    <div style={{position: 'fixed', right: 18, bottom: 18, zIndex: 50}}>
      {open && (
        <div
          style={{
            width: 280,
            marginBottom: 10,
            background: '#fff',
            border: '1px solid #eef2f0',
            borderRadius: 16,
            boxShadow: '0 16px 40px rgba(36,54,115,0.18)',
            padding: 16,
            fontFamily: 'Montserrat, sans-serif',
            color: '#243673',
          }}
        >
          <strong style={{display: 'block', marginBottom: 6}}>
            Pet Centre assistant
          </strong>
          <p style={{margin: '0 0 8px', fontSize: 13, color: '#51607a'}}>
            Hi! Ask us about products, the vet, grooming or your order.
          </p>
          <p style={{margin: 0, fontSize: 11, color: '#8a93a6'}}>
            🤖 You’re chatting with an automated AI assistant.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open chat"
        style={{
          background: '#00975a',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          padding: '12px 18px',
          fontWeight: 700,
          fontFamily: 'Montserrat, sans-serif',
          boxShadow: '0 10px 24px rgba(0,151,90,0.35)',
          cursor: 'pointer',
        }}
      >
        💬 Chat
      </button>
    </div>
  );
}
