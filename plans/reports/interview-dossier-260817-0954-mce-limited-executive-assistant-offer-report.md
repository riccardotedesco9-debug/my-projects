# MCE Limited — offer-stage briefing (Executive Assistant)

**TLDR** — Drop the reduced-hours ask, take the rate. Three findings flip the picture: (1) a written advert
EXISTS, posted 2026-08-03 on MCE's own site, titled **Executive Assistant** (not PA), explicitly
"Full-Time"; (2) the EA title benchmarks at a €36,830 Malta median vs €21,500 for "PA", so €15/hr
(= €31,200 FTE) is BELOW market for the job as they wrote it; (3) Malta's Pay Transparency regs
(LN 173/2026, in force 2026-06-07) give an applicant the right to be told the pay range and PROHIBIT
salary-history questions, so he need not go first. Ask €35k, target €32k, walk below €27k. Highest-value
non-pay ask: cut the statutory **12-month** administrative probation to 6 months in writing.

Published artifact: https://claude.ai/code/artifact/ee94ddf4-8847-4550-b2be-774dc742241a

---

## Method + honest limits

Four parallel Workflow sweeps, 22 lanes, ~50 researchers, adversarial verification + per-field provenance.
**Firecrawl exhausted credits early** → most work ran on fallback WebSearch/WebFetch. Malta government
domains (dier.gov.mt, nso.gov.mt, mtca.gov.mt), LinkedIn (HTTP 999), Facebook, timesofmalta.com, MBR
(Angular SPA), OpenCorporates (CAPTCHA), Dato Capital (403) all block the fallback. Gaps cluster there.
Session limit also killed 28 of 45 agents mid-run; the 17 that completed carried the load.

## Corporate identity

| Field | Value | Source |
|---|---|---|
| Registered name | MCE Limited | own letterhead |
| Company reg. | **C3459** (EUID MTROC.C3459) | MCE privacy-policy letterhead + North Data |
| VAT | **MT 1152-8707** | same letterhead |
| Registered office | MCE House, Triq l-Industrija, Zone 5, CBD, Qormi. Both QRM 3001 and CBD 5030 live | own site + 3 directories |
| Officers | 2 directors, 2 auth. signatories, 1 secretary, 1 auditor (names gated) | North Data |
| Tel | +356 21486213 / +356 21441275 | own contact page |
| LEI | none exists for any MT-domiciled MCE (GLEIF API, total 0) | api.gleif.org |
| NOT established | incorporation date, share capital, current shareholder register | MBR unreadable |

**Entity-confusion trap:** a Jersey "MCE LIMITED" exists in GLEIF (LEI 549300WDHFFVVRXEES11, LAPSED).
Not the target. Pin the Maltese entity via Qormi address, mcemalta.com, C3459, or Puglisevich.

**Birkirkara vs Qormi resolved:** Malta's CBD is the former **Mrieħel Industrial Estate**, contains Triq
l-Industrija, and spans parts of Birkirkara, Qormi and Santa Venera. One site; area reads as
Birkirkara/Mrieħel, paperwork says Qormi. Riccardo's Birkirkara shop = MCE House complex.

## The advert (the single highest-value artifact)

`https://mcemalta.com/news-item.aspx?sysref=13114` — posted **2026-08-03**, "Job Type: Full-Time",
location Hal-Qormi, apply admin@mcemalta.com subj "Executive Assistant Application - [Your Name]".

Duties (verbatim, 5 clusters): gatekeeper for **the executive's** calendar (singular throughout); screen
calls + manage email + draft communications on the executive's behalf; domestic + international travel;
briefing materials/agendas/presentations + minutes + follow-up tracking; "highly sensitive corporate and
personal information".

Requirements: only MS Office 365 or Google Workspace + Zoom/Teams, organisational skills, "polished
corporate presence", calm under pressure. **No degree, no years-of-experience minimum, no Maltese** (their
same-day Project Site Installer advert DOES require Maltese).

"What We Offer" in full: "Competitive salary" / growth / "collaborative, inclusive, and modern working
environment". Zero concrete benefits → total vacuum, everything winnable.

Self-description: "For over 50 years... trusted wholesaler specializing in **electrical and plumbing
supplies, tooling machines and accessories, and lightning protection and earthing installation**"; "team as
an extension of our family"; "long-term career where your loyalty and dedication are genuinely valued".

**Newly created role:** 102 news items Feb 2015–Aug 2026 contain only 3 vacancies ever, and this is the
FIRST office/admin one. Historically admin was done by family (Richard Puglisevich Chase, Office
Administrator 2014–16) or 240-hour student work-exposure placements. No incumbent anchor.

## Pay

MCE's own published band (EURES/Jobsplus vac. 420178, 2025-08-13): **Project Administrator €26,500–€29,000
pa** + "government quarterly bonuses €520 p.a." + "Rebate on use of private mobile €360pa", indefinite.
→ €29k is the FLOOR of the conversation, not the ceiling.

Divisor: 40h week → **2,080 paid hours**. €15/hr = €31,200 FTE. €12/hr = €24,960 FTE.

| Benchmark | Annual | Hourly | Year |
|---|---|---|---|
| National minimum wage | €11,931 | €5.74 | 2026 |
| NSO clerical support workers | €21,252 | €10.22 | Q1 2026 |
| NSO wholesale/retail (MCE's sector) | €22,620 | €10.88 | Q1 2026 |
| "Personal Assistant" title | ~€21,500 | €10.34 | 2026 |
| NSO all-occupations avg | €27,240 | €13.10 | Q1 2026 |
| MCE's own 2025 admin band | €26,500–29,000 | €12.74–13.94 | 2025 |
| **His €12 "floor"** | €24,960 | €12.00 | — |
| **His €15 ask** | €31,200 | €15.00 | — |
| **"Executive Assistant" title median** | **€36,830** | €17.71 | 2026 |
| EA range entry→senior | €26,632–41,769 | €12.80–20.08 | 2026 |

Live comparators Aug 2026: PA/Office Admin to Director+COO, **Qormi**, **€30–35k** (demands diploma +
Maltese, more than MCE asks); E&PA to CEO/COO €30–35k (wants "AI tools and other systems", 6-mo probation,
hybrid); Exec PA to COO €28–32k; Executive Operations Officer €25–40k **because it bundles "reporting,
audits, and compliance requirements"** on 1–3 yrs exp ← the premium argument; PA to CEO €35–40k (medium
conf).

**Recommendation:** open €35,000 · target €32,000 · good €30,000 · walk below €27,000.
Malta pay moving 3–5.4%/yr, so 2025 benchmarks understate 2026 by 5–10%.

Gross→net 2026 (single, incl. €512.52 bonus, NI capped €2,908.36): €24k→€1,615/mo · €26k→€1,724 ·
€28k→€1,832 · €30k→€1,948 · €32k→€2,073 · €35k→€2,261. NI cap bites ~€29,084, so marginal euros above that
convert at ~75% not ~65%.

**Never quote hourly.** 26/26 live Malta admin/EA adverts quoted ANNUAL, including the part-time ones.
Hourly quoting in Malta = cleaning, hospitality, tutoring, casual. Also: MCE's own electricians/plumbers
earn €8.08–10.96/hr per 2026 guide bands — €15/hr for a PA breaches internal equity and she'll decline
silently.

## The 30h @ €15 verdict: drop it

**His arithmetic is RIGHT.** True employer cost 30h@€15 = €26,194.59 vs 40h@€12 = €28,043.40 → **€1,849/yr
cheaper**, slightly better than the €1,560 he computed on gross. Malta has no flat per-head employer cost at
this level (SSC 10% proportional Cat C, maternity fund 0.3%, no employer pension, no mandatory health
cover), so part-time isn't penalised.

**But:**
- Comparison is rigged: prices him at €15 and the counterfactual at €12. Hold rate constant → 30h@€12 =
  €18,720 vs 40h@€12 = €24,960. Offering €12 full-time concedes the work is worth €12/hr, which she then
  anchors to for 30h. Costs him ~€4,700.
- **Per hour: €16.79 vs €13.48 = 24.5% MORE per hour for 25% less capacity.** Needs sustained 33.3%
  productivity uplift from day one, unverifiable, no PA track record.
- **Coverage:** 3 of 5 advertised duty clusters break on absence (can't gatekeep a calendar
  asynchronously; can't screen calls from an empty desk; MD schedules meetings around counterparties).
  Trading window Mon–Fri 08:00–17:00 + Sat morning → 6h day leaves **15h/week ≈ 780h/yr** of open-for-
  business time uncovered. Compressing to 4 days concentrates the same gap.
- **Leave trap:** 216h FTE pro-rates to 162h at 30h/week, but 162÷6 = **27 days — identical** to 216÷8.
  Same whole-day absences PLUS a 3h hole in every remaining day.
- **Zero statutory leverage:** LN 201/2022 flexible-work request covers only parents of children ≤8 and
  carers. No right to request, no duty to consider, no reply deadline, no appeal. Part-Time Employees Regs
  (LN 427/2002) protect part-timers once employed but create no right to BECOME part-time. (Useful
  corollary: same hourly rate pro rata is mandatory — a shield against rate discounting.)
- Part-time ≈ 1 in 17 live Malta admin vacancies, and that one paid LESS.
- He'd be the precedent, granted to the newest and best-paid admin hire, visible from a front desk.

**If he still wants it,** ranked by cheapness to her: (1) full-time now + written review point; (2)
coverage guarantee (phone/inbox across the 14:00–17:00 tail) instead of hours; (3) fixed core hours;
(4) time-bound trial reverting to 40h by default; (5) named, dated, measurable automations to evidence the
33%; (6) 30h @ €12 = €21,033 — the only variant cheaper on BOTH measures, costs him ~€10k.

## Contract traps (2026 Maltese law)

1. **12-MONTH PROBATION.** EIRA art 36(1b): administrative posts paid ≥ **double** min wage
   (**€23,861.76/yr, €458.88/wk** for 2026) get 12 months, not 6. Every realistic salary clears it.
   12 months at-will, 1 week notice. **art 36(1c) permits shorter by agreement** → get 6 months in writing.
   Costs MCE nothing. Highest-value ask on the table. Also gates the art-14 right to request more
   predictable conditions (triggers at 6 months service AND completed probation; SME reply window 3 months).
2. **"Excluded employee" clause.** S.L. 452.87 reg 13 — "managing executives or other persons with
   autonomous decision-taking powers" or time that "can be determined by the worker" disapplies 11h daily
   rest, rest break, 24h weekly rest AND the 48h ceiling in one clause. Factually wrong for a PA whose
   hours follow the MD's diary. Read for it, get it out.
3. **Exclusivity vs his ATPL.** S.L. 452.126 reg 12 — employer may NOT prohibit outside employment outside
   the agreed schedule except on objective grounds (H&S, confidentiality, conflict of interest). Flying is
   none of those for an electrical wholesaler. Narrow it, don't sign-and-hope.
4. **48h opt-out** must be a SEPARATE written agreement; refusal cannot be held against him; default
   revocation 7 days but employer may stretch to 3 months. Insist 7.
5. **"Salary covers whatever hours the job needs"** is expressly non-compliant — DIER: packages including
   an unknown amount of overtime don't conform with the transparency regs. Lawful form: stated normal
   hours, or "allowance of €X for up to Y hours".
6. **Notice.** art 36(5)(f) allows LONGER than statutory for administrative posts. art 36(10) asymmetry:
   employee failing to give notice owes HALF the wages; employer owes FULL. Keep short or make mutual.
7. **Leave = 216h / 27 days** for 2026 (192 base + 24 for 3 weekend public holidays: Sette Giugno Sun 7
   Jun, Santa Marija Sat 15 Aug, Republic Day Sun 13 Dec). It's the FLOOR. 25 days would be unlawful.
   Express in HOURS so the top-up recalculates yearly. **The 14 public holidays are SEPARATE and paid** —
   "27 days inclusive of public holidays" silently strips ~14 days.
8. **Shutdowns.** Employer may use max **12 working days** of annual leave for shutdowns, announced by end
   January. MCE runs recurring August + Christmas shutdowns (documented 2015, 2019, 2020, 2022, 2024). If
   they take all 12, discretionary leave is 15 days. Ask.
9. **Statutory bonus €512.52/yr** in 4 payments (€121.16 end Mar, €135.10 end Jun, €121.16 end Sep,
   €135.10 15–23 Dec). ON TOP of wages, cannot be absorbed. **COLA €4.66/wk = €242.32/yr** mandatory and
   additional — don't let it be presented as the merit rise.
10. **New Conditions of Work Regulation Orders from 2026-06-30** (LN 112–143/2026) replaced all WROs. MCE's
    is **LN 125/2026 Wholesale and Retail Trades** (Gazette 21,635, 30.04.2026). Changes: sick leave from
    DAY ONE, bereavement + marriage leave 3 days each, free uniforms/PPE, Sunday work only on written
    consent. Template almost certainly not updated → ask.
11. Written contract + core info within **7 calendar days**; job description required by reg 5(1)(d) — the
    statutory hook against scope creep. Verbal contracts are fully binding in Malta, so don't accept
    verbally.
12. Non-competes: not expressly regulated, Maltese courts interpret restrictively and have voided them as
    restraint of trade given Malta's geography. Still narrow it rather than relying on unenforceability.
13. Protection: if he asserts a statutory right and is then dismissed, burden shifts to employer
    (S.L. 452.126 reg 18 / S.L. 452.87 reg 21). Unfair dismissal → Industrial Tribunal within 4 months.

## People

- **Ivor John Puglisevich** — MD, shareholder. Accounts background → Salesman → Sales Manager → MD. "In
  2018, my wife and I bought the company from the other family members. Our goal is to increase our market
  share and take the company to the next level." Father of two; biker, musician, tennis, golf. Profiled as
  "it is never too late to learn". **Personally writes MCE's tender objections** → hands-on with documents.
  Almost certainly "the executive" in the advert, and the pay decision-maker.
- **Susanne (LinkedIn: Suzanne) Puglisevich** — Director, shareholder. Little else published.
- **Nicola Puglisevich** — Purchasing Executive (LinkedIn, from Feb 2018, ~8.5 yrs) + **Data Protection
  Officer** named in MCE's own privacy policy with npuglisevich@mcemalta.com; **authored** that policy
  (PDF metadata /Author NicolaPuglisevich, created 2018-05-17). FBO: "joined the management team, driving
  innovation and modernization within the company processes." **Most likely interviewer** and the natural
  ally for an automation pitch.
- **Lionel Puglisevich** — founder 1976, former Company Secretary. Died 27/28 Jan 2022 aged 87. Four
  children: Stephanie, Ivor, Judith, Adrian. Also held Longhorn Securities Ltd (in dissolution).
- **Adrian Puglisevich** — pre-2018 shareholder/director, among those bought out.
- Staff: Andrew Vella (Retail and Stores Manager, since Jan 2023), Adrian Pace (Head, Tooling Division),
  Paul Cortis (technical). Former: Robert Fenech (Stores & Purchasing 2018–21), Tony Attard (CPA 2016–18),
  Richard Puglisevich Chase (Office Administrator 2014–16, now Glasgow).

**Interviewer ID:** rank 1 Nicola (best fit on published remit; but public sources say she is NOT a
shareholder, so his "family shareholder" read is likely wrong in detail); rank 2 Susanne (literally a
shareholder, but published role is Director not front-office); rank 3 an unnamed senior non-family
administrator (cannot be excluded — MCE's office staff are invisible online, no LinkedIn company page).
**Cannot be conclusively separated.** Safe confirmation: ask the meeting arranger "who will I be meeting,
and should I send anything in advance?", or read the email signature.

**Employer read:** no HR function (generic admin@ inbox, no careers/team page, no LinkedIn company page).
Tenure evidence thin but not alarming: 3y8m current, 3y2m, 2y. Zero employee reviews anywhere (normal for
a Maltese SME). Website dormant ~22 months (Oct 2024 → Aug 2026) then two vacancies same day. Dropped
external ISO auditing — "operates its own quality procedures and is no longer externally audited".

## Business

Divisions: Engineering & Tooling · Electrical & Plumbing · Plastics (polyethylene) · Heating & Ventilation
· plus a live **Projects Division** (outside contracts, earthing, lightning protection, at-height work).
Website presents only 2 of 4 divisions; Plastics and H&V have no product pages. **No working e-commerce** —
cart ends in a "SEND INQUIRY" basket, no checkout, no terms of sale, but trade prices are public.

~60 named principals. Electrical/lighting: **Eaton, ABB Furse, ELT, BLV, Orbis, IDE, Cembre**, Elmark,
COSMEC, Clarke. Tooling: **Mitutoyo, Dormer Pramet, Kennametal, ZCC, Knuth, Fervi**, Röhm. Described by
third parties as **ABB Furse's local agent** in Malta. Carries **Orbis "Viaris" EV chargers**.
Differentiation = named agencies, not price.

~40 named turnkey projects incl. **Mater Dei Hospital, MIA control tower, Malta–Sicily Interconnector,
Central Bank of Malta, Auberge de Castille**, Portomaso, Birkirkara Tennis Club, Buġibba Promenade. Supplied
Enemalta-grade overhead line hardware (Dalekovod reference list, 11 kV tension strings, contract 228/06).

2026 commercial push (Facebook): bathroom/shower ware, Elmark protection + floodlights, COSMEC conduit,
industrial plugs/sockets, Clarke power tools. Recurring supplier-backed seminars at Corinthia hotels, some
with the Malta Group of Professional Engineering Institutions. Sponsors Kerċem Ajax FC (Gozo).

**Financials — no filed accounts public.** D&B USD 1.63M labelled "Actual" but classifies MCE as a
MANUFACTURER (wrong bucket); ZoomInfo USD 7M + 11–50 employees, classified correctly as merchant
wholesaler; structural estimate 25–60 staff. USD 1.63M implausibly low against a single €338,470 university
contract. **Do not quote any figure.** Volza shows only 30 import shipments, 2 verified suppliers, both
Turkey.

Competitors: **AJ Electric Co Ltd** (~9× larger on D&B, ~200 outlets Malta+Gozo) · **Electro Fix Ltd**
(Qormi, into renewables since 2005, did PV at MIA and MCAST) · Elektra, Hydrolectric, IML Electrical
Supplies, ESS, Illumitech, P&J Electrical, Medelec Switchgear, ETAS & S, K & Co., Delta (Malta). NOT a
competitor: Oxford House (appliances/furniture).
Customers: electrical + building-services contractors (RAICO, JT Installations, Rainbow Turnkey, Galea
Supplies) plus Enemalta and government works.

Market drivers: **Enemalta €141m distribution-network programme 2023–2026** (190 new substations Malta + 18
Gozo, 260+ transformers, 120+ switchgear, 875 LV feeders, 270+ km MV cable) · Malta Chamber warning
2026-03-07 of "potentially severe supply chain disruption and inflationary shock", shipping up to 3× with
low-volume Maltese consignments bumped · db/Hard Rock St George's Bay €300m scheme · **EU Construction
Products Regulation puts a non-delegable duty on distributors** to ensure CE-marked compliant cables and
supply the Declaration of Performance ← documentation control = his skillset.

## Public record

Government supplier 2002–2025, no debarment found. Won **€338,469.83 University of Malta** lightning
protection contract, Msida campus, awarded 2025-04-22. Smaller: €8,903 lightning-protection certification
(SVP 09/2023), €820.02 emergency surge protector at Qammieħ, a 2005 tools contract.
Tender appeals: 2014 objection (€65,000 tender, 6 bidders, offer ruled administratively non-compliant);
2022 MCAST appeal (PCRB found FOR MCE on procedure, declared the rejection letter null and void, MCE lost
on merits); July 2025 University floodlighting appeal (840W offered vs 850W specified; University conceded
one of two grounds).

**Two revealing litigation facts:** MCE is a **habitual plaintiff for debt recovery** — ≥10 published
judgments as claimant vs 1 as principal defendant → live, document-heavy collections function. And in
**2010 MCE escaped a product-quality damages claim by successfully pleading it is only an AGENT, not the
seller**, its own director testifying to that model in open court.

**Employment/safety: nothing found ≠ clean.** DIER 403'd throughout. **OHSA publishes enforcement
anonymised** ("Employer" + locality + reference) and only for a rolling 6 months, so a clean OHSA search
proves nothing — and MCE combines warehousing with at-height electrical work. An anonymised Qormi employer
case (unexamined forklift lifting gear, unused fall-arrest harnesses) sits in the current window and
**CANNOT be attributed to MCE**. Do not raise it.

Awards claimed ("International Award for Commerce", "Quality in People Award") rest solely on MCE's own FBO
profile, no awarding body, no year, 1990s/2000s era.

## Do-not-say list

Any turnover figure · "you have a clean legal/safety record" · anything about a sanctions listing (North
Data renders a "Sanctioned" template label with no list, authority, date or matched name — a rendering
artifact) · any incorporation date · a Valletta registered office (one 2025 tender snippet mentioned 58
Zachary Street, may belong to another party) · his Aristocrat salary (they're prohibited from asking) ·
€12 · an hourly rate · the Puglisevich Brothers group (no link established either way) · why the family
sold in 2018.

## Unresolved

1. Current official directors/shareholders/share capital — search **C3459 at registry.mbr.mt** in a
   browser. Specifically: is Nicola a registered director, and does the 2018 sole-shareholder position
   still hold?
2. Operative text of **LN 125/2026** (sick leave hours, overtime, normal hours) — legislation.mt served
   metadata only. This is his true floor.
3. Trading hours: 08:00–17:00 + Sat morning from two directories; MCE's own contact page shows none. One
   lane read Sat 08:00–12:30, another 08:30–12:30. Verify before proposing any schedule.
4. Whether front-desk/counter cover is actually in scope — absent from the written advert but plausible
   given the on-site shop, Saturday trade and the reception-facing seat he observed. **Determines whether
   reduced hours is even possible.** Must be asked directly.
5. Headcount, and whether any existing MCE employee already works non-standard hours (if one does, the
   precedent objection largely evaporates).
6. The Facebook advert's posting date and whether its wording ("support our leadership", plural) differs
   from the website version ("the executive", singular).
7. Whether a genuinely separate Birkirkara branch exists vs the CBD/Mrieħel reading. Evidence favours one
   site.
8. Broadwing / misco / Reed Malta salary guides — all gated or paywalled. The recruiter-survey layer for
   PA/EA remains the biggest unfilled pay-evidence gap; the range here rests on NSO + live adverts instead.
