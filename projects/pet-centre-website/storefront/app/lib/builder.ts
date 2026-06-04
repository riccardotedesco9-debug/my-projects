import {fetchOneEntry} from '@builder.io/sdk-react';

// Builder.io public API key for the "Riccardo Tedesco" space.
// Public by design (it ships in client bundles) — safe to inline.
export const BUILDER_PUBLIC_API_KEY = '6dc7b5fe062641aba00bcbdab6b2917f';
export const BUILDER_MODEL = 'page';

/** Fetch the Builder page whose targeting matches this URL path (or null). */
export function getBuilderPage(urlPath: string) {
  return fetchOneEntry({
    model: BUILDER_MODEL,
    apiKey: BUILDER_PUBLIC_API_KEY,
    userAttributes: {urlPath},
  });
}
