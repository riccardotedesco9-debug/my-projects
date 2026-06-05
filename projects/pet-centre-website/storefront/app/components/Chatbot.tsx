import {useEffect} from 'react';

/**
 * Site-wide chat. Loads the managed Crisp widget (France/EU-hosted, GDPR + EU
 * AI Act friendly) when a Website ID is configured via PUBLIC_CRISP_WEBSITE_ID.
 * With no ID set it renders nothing — no placeholder bubble, so the UI never
 * looks half-built. Crisp draws its own bubble, so there is no custom markup.
 */
export function Chatbot({websiteId}: {websiteId?: string}) {
  useEffect(() => {
    if (!websiteId) return;
    const w = window as unknown as {
      $crisp?: unknown[];
      CRISP_WEBSITE_ID?: string;
    };
    w.$crisp = w.$crisp ?? [];
    w.CRISP_WEBSITE_ID = websiteId;
    const s = document.createElement('script');
    s.src = 'https://client.crisp.chat/l.js';
    s.async = true;
    document.head.appendChild(s);
  }, [websiteId]);

  return null;
}
