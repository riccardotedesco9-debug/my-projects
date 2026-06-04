# Pet Centre storefront — go live (deploy to Oxygen)

The storefront (`storefront/`) is built and verified on mock data. Two things take it live:
**connect the real store**, then **deploy**. Both go through the **Hydrogen sales channel** — the
cleanest path, because it provisions a valid **Storefront token** AND free **Oxygen** hosting in one
step (this also replaces the earlier manual custom-app token that returned 401).

> These three commands are interactive (browser sign-in) and must be run in **your own terminal** —
> they can't be driven headlessly by the agent.

## 1. Add the Hydrogen channel (one-time, in Shopify admin)
- Shopify admin → **Sales channels** → **＋** → add **Hydrogen** (a.k.a. Headless).
- **Create a storefront** → it generates a **Storefront API token** + an **Oxygen** deploy target.

## 2. Link the local project (one browser sign-in)
From `projects/pet-centre-website/storefront/`:
```
shopify hydrogen link
```
- A browser opens → **Authorize** → pick the storefront you just created.
- This writes the real `PUBLIC_STORE_DOMAIN` + `PUBLIC_STOREFRONT_API_TOKEN` into `.env`
  (swaps mock.shop → your real `dsgncm-nw` store automatically). Then:
```
npm run dev    # now renders your REAL products/cart
```

## 3. Deploy
```
shopify hydrogen deploy
```
- Returns a live Oxygen URL. For auto-deploy on every change, connect the GitHub repo in the
  Hydrogen channel (**Deployments → connect repository**) — after that, `git push` ships it.

## After go-live — swap the remaining placeholders (no rebuild)
- **Chatbot:** set the real Crisp website ID in `app/components/Chatbot.tsx`.
- **Booking:** paste your Cal.com / Calendly inline URL into `app/routes/book.tsx`.
- **Homepage** stays your Builder design; product/collection/cart pages show real Shopify data;
  "Shop" buttons already point to `/collections/all`.
