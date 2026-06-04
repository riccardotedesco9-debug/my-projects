import {useLoaderData} from 'react-router';
import {Content, isPreviewing} from '@builder.io/sdk-react';
import type {Route} from './+types/$';
import {
  BUILDER_MODEL,
  BUILDER_PUBLIC_API_KEY,
  getBuilderPage,
} from '~/lib/builder';

export async function loader({request}: Route.LoaderArgs) {
  const url = new URL(request.url);

  // Shopify's own routes (products, collections, cart, _index, etc.) match
  // first. Anything unmatched falls through here and is served from Builder,
  // so marketing/content pages (e.g. /contact, /vet-grooming) render from the
  // visual editor while commerce stays native Hydrogen.
  const content = await getBuilderPage(url.pathname);

  if (!content && !isPreviewing(url.search)) {
    throw new Response(`${url.pathname} not found`, {status: 404});
  }

  return {content};
}

export default function BuilderCatchAllPage() {
  const {content} = useLoaderData<typeof loader>();
  return (
    <Content
      model={BUILDER_MODEL}
      content={content ?? undefined}
      apiKey={BUILDER_PUBLIC_API_KEY}
    />
  );
}
