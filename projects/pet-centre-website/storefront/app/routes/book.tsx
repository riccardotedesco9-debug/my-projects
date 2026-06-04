import type {Route} from './+types/book';

export const meta: Route.MetaFunction = () => [
  {title: 'Book a visit | Pet Centre'},
];

// Placeholder — paste your Cal.com / Calendly inline embed URL here to go live.
const SCHEDULER_EMBED_URL = '';

export default function BookPage() {
  return (
    <div
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '52px 20px',
        fontFamily: 'Montserrat, sans-serif',
        color: '#243673',
      }}
    >
      <h1 style={{fontFamily: 'Fredoka, sans-serif', fontSize: 34, margin: 0}}>
        Book a vet or grooming visit
      </h1>
      <p style={{color: '#51607a', marginTop: 8}}>
        Pick a time that suits you — we’ll confirm by email.
      </p>

      {SCHEDULER_EMBED_URL ? (
        <iframe
          src={SCHEDULER_EMBED_URL}
          title="Booking calendar"
          style={{
            width: '100%',
            height: 700,
            border: 0,
            borderRadius: 16,
            marginTop: 20,
          }}
        />
      ) : (
        <div
          style={{
            marginTop: 24,
            background: '#f7faf8',
            border: '1px dashed #b9d8c9',
            borderRadius: 20,
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{fontSize: 34}}>📅</div>
          <strong style={{display: 'block', margin: '8px 0', fontSize: 18}}>
            Booking calendar
          </strong>
          <p style={{color: '#51607a', maxWidth: 460, margin: '0 auto'}}>
            Your scheduling tool (Cal.com / Calendly) embeds here — connect an
            account and paste its inline link to go live.
          </p>
          <p style={{marginTop: 14}}>
            In the meantime,{' '}
            <a href="/contact" style={{color: '#00975a', fontWeight: 700}}>
              contact us
            </a>{' '}
            to book.
          </p>
        </div>
      )}
    </div>
  );
}
