# Pet Centre storefront — deploy & go-live

The storefront (`../storefront/`) is **built, Oxygen-linked, and already deployed to Production**.
This is how to redeploy and how to make it publicly viewable.

## Current state
- **Production URL:** `https://my-store-bc19f2075e1627c3f983.o2.myshopify.dev` — **Private** (403 to the
  public) until you flip it to Public.
- Linked store: `dsgncm-nw.myshopify.com`. Env is injected **from Oxygen** at dev/deploy (no local
  `.env` needed).
- 15 products live; Builder homepage + content pages (`/contact`, `/vet-grooming`, `/book`) render.

## Redeploy (after any change)
The Shopify CLI keeps a cached session — no login needed. From `../storefront/`, in **your own terminal**:
```
pnpm shopify hydrogen deploy --force
```
Answer **yes** to "Continue?" — it builds + ships to Production and prints the URL. `--force` skips the
git-clean check. (The agent can't answer that prompt headlessly, so this step stays owner-run; a CI/headless
deploy needs `CI=true … --token <oxygen-deploy-token>` from the Hydrogen dashboard.)

## Make it public (go live)
Hydrogen sales channel → **My Store** → **Production** environment → set to **Public**. Then the URL above
loads for anyone. Attach the custom domain **petcentremalta.com** in the same area when ready.

## View locally (full site, no gate)
From `../storefront/`: `pnpm dev` → http://localhost:3000/ (renders the Builder home + real products).

## Swap the remaining placeholders (redeploy after)
- **Chatbot:** real Crisp website ID in `app/components/Chatbot.tsx`.
- **Booking:** Cal.com / Calendly inline URL in `app/routes/book.tsx`.
- **Products:** add images / refine via `tools/seed-catalog.mjs` (re-runnable) or the Shopify admin.
