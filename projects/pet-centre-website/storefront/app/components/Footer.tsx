import {NavLink} from 'react-router';
import type {FooterQuery, HeaderQuery} from 'storefrontapi.generated';
import {PawMark} from '~/components/Logo';

interface FooterProps {
  footer: Promise<FooterQuery | null>;
  header: HeaderQuery;
  publicStoreDomain: string;
}

const SHOP_LINKS = [
  {title: 'Dogs', url: '/collections/dogs'},
  {title: 'Cats', url: '/collections/cats'},
  {title: 'Fish & Aquatics', url: '/collections/fish-aquatics'},
  {title: 'Birds', url: '/collections/birds'},
  {title: 'Reptiles', url: '/collections/reptiles'},
  {title: 'Small Animals', url: '/collections/small-animals'},
];

const COMPANY_LINKS = [
  {title: 'Vet & Grooming', url: '/vet-grooming'},
  {title: 'Pet Club rewards', url: '/pet-club'},
  {title: 'Book a visit', url: '/book'},
  {title: 'About us', url: '/about'},
  {title: 'Contact', url: '/contact'},
];

const LEGAL_LINKS = [
  {title: 'Privacy', url: '/policies/privacy-policy'},
  {title: 'Refunds', url: '/policies/refund-policy'},
  {title: 'Shipping', url: '/policies/shipping-policy'},
  {title: 'Terms', url: '/policies/terms-of-service'},
];

export function Footer(_props: FooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="footer-top">
        <div className="footer-brand">
          <span className="header-logo">
            <PawMark className="paw" />
            Pet Centre
          </span>
          <p>
            Your neighbourhood pet shop &amp; vet in Mellieħa — premium food,
            expert advice, grooming and in-house veterinary care, all under one
            roof.
          </p>
          <div className="footer-social">
            <a href="https://facebook.com" aria-label="Facebook" target="_blank" rel="noreferrer">
              <SocialIcon name="facebook" />
            </a>
            <a href="https://instagram.com" aria-label="Instagram" target="_blank" rel="noreferrer">
              <SocialIcon name="instagram" />
            </a>
            <a href="https://wa.me/356" aria-label="WhatsApp" target="_blank" rel="noreferrer">
              <SocialIcon name="whatsapp" />
            </a>
          </div>
        </div>

        <div className="footer-col">
          <h4>Shop</h4>
          <ul>
            {SHOP_LINKS.map((l) => (
              <li key={l.url}>
                <NavLink to={l.url}>{l.title}</NavLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer-col">
          <h4>Pet Centre</h4>
          <ul>
            {COMPANY_LINKS.map((l) => (
              <li key={l.url}>
                <NavLink to={l.url}>{l.title}</NavLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer-newsletter footer-col">
          <h4>Stay in the loop</h4>
          <p>Join our newsletter for offers, pet-care tips and event news.</p>
          <form method="post" action="/newsletter">
            <input
              type="email"
              name="email"
              placeholder="Your email"
              aria-label="Email address"
              required
            />
            <button type="submit" className="button">
              Join
            </button>
          </form>
          <div className="footer-meta" style={{marginTop: '1.5rem'}}>
            <strong>Visit us</strong>
            Triq il-Kbira, Il-Mellieħa, Malta
            <br />
            Mon–Sat 9:00–19:00 · Sun closed
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <span>© {year} Pet Centre · Made with care in Mellieħa 🇲🇹</span>
          <nav>
            {LEGAL_LINKS.map((l) => (
              <NavLink key={l.url} to={l.url}>
                {l.title}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

function SocialIcon({name}: {name: 'facebook' | 'instagram' | 'whatsapp'}) {
  const common = {width: 18, height: 18, viewBox: '0 0 24 24', fill: 'currentColor'};
  if (name === 'facebook') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5H17V3.6c-.3 0-1.3-.1-2.45-.1-2.42 0-4.05 1.47-4.05 4.18v2.32H7.8V13h2.7v8h3z" />
      </svg>
    );
  }
  if (name === 'instagram') {
    return (
      <svg {...common} aria-hidden="true">
        <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16Zm0 1.8c-3.15 0-3.5.01-4.74.07-1.14.05-1.76.24-2.17.4-.55.21-.94.47-1.35.88-.41.41-.67.8-.88 1.35-.16.41-.35 1.03-.4 2.17-.06 1.24-.07 1.59-.07 4.74s.01 3.5.07 4.74c.05 1.14.24 1.76.4 2.17.21.55.47.94.88 1.35.41.41.8.67 1.35.88.41.16 1.03.35 2.17.4 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c1.14-.05 1.76-.24 2.17-.4.55-.21.94-.47 1.35-.88.41-.41.67-.8.88-1.35.16-.41.35-1.03.4-2.17.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.05-1.14-.24-1.76-.4-2.17a3.6 3.6 0 0 0-.88-1.35 3.6 3.6 0 0 0-1.35-.88c-.41-.16-1.03-.35-2.17-.4-1.24-.06-1.59-.07-4.74-.07Zm0 3.06a4.98 4.98 0 1 1 0 9.96 4.98 4.98 0 0 1 0-9.96Zm0 1.8a3.18 3.18 0 1 0 0 6.36 3.18 3.18 0 0 0 0-6.36Zm5.18-.78a1.16 1.16 0 1 1-2.32 0 1.16 1.16 0 0 1 2.32 0Z" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.3.4.6 2.2-2.3-.6-.4.2A8.2 8.2 0 1 1 12 3.8Zm-3 4c-.2 0-.5 0-.7.4-.2.4-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.7 4.2 3.7 2 .8 2.4.7 2.9.6.5-.05 1.5-.6 1.7-1.2.2-.6.2-1.1.15-1.2-.05-.1-.2-.15-.5-.3l-1.4-.7c-.2-.05-.35-.1-.5.1l-.7.85c-.1.15-.25.17-.45.07a5.7 5.7 0 0 1-1.7-1.05 6.4 6.4 0 0 1-1.15-1.45c-.1-.2 0-.3.1-.4l.3-.4c.1-.15.15-.25.2-.4.05-.15 0-.3 0-.4l-.65-1.55c-.15-.4-.35-.35-.5-.35h-.4Z" />
    </svg>
  );
}
