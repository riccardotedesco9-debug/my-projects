import {redirect} from 'react-router';
import type {Route} from './+types/newsletter';

/**
 * Newsletter capture endpoint — the footer form posts here. The email is
 * accepted and the visitor is returned home. When a marketing account is
 * connected (Shopify Email / Klaviyo), wire the capture in the marked spot;
 * the rest of the flow (form, route, redirect) is already in place.
 */
export async function action({request}: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') || '').trim();
  if (email && email.includes('@')) {
    // TODO: forward to Shopify Email / Klaviyo / customer-create when connected.
    console.log('[newsletter] signup:', email);
    return redirect('/?subscribed=1');
  }
  return redirect('/?subscribed=invalid');
}

export async function loader() {
  return redirect('/');
}
