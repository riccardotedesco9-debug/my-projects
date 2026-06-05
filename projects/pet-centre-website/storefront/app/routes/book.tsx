import type {Route} from './+types/book';

export const meta: Route.MetaFunction = () => [
  {title: 'Book a visit | Pet Centre'},
];

// Cal.com booking page (embedded inline). Swap the slug to change the event.
const SCHEDULER_EMBED_URL = 'https://cal.com/riccardo-tedesco-tilt5l/test';

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
          <div style={{fontSize: 34}}>🐾</div>
          <strong style={{display: 'block', margin: '8px 0', fontSize: 18}}>
            Online booking is coming soon
          </strong>
          <p style={{color: '#51607a', maxWidth: 460, margin: '0 auto'}}>
            We’re putting the finishing touches on instant online booking. In the
            meantime, pop into the shop in Mellieħa or send us a message and we’ll
            find a time that suits you and your pet.
          </p>
          <p style={{marginTop: 14}}>
            <a href="/contact" style={{color: '#00975a', fontWeight: 700}}>
              Get in touch to book →
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
