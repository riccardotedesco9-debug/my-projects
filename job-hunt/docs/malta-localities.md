# Malta localities reference

Used by the malta-gate (locality allowlist) and score.ts (drive-30min-from-Mellieħa boost).

## Drive ≤ 30 min from Mellieħa
Northern corridor + central Malta — easy commute. Gets +10 score boost.

```
Mellieħa, St Paul's Bay (San Pawl il-Baħar), Buġibba, Qawra, Xemxija,
Mġarr, Mosta, Naxxar, Għargħur, Attard, Rabat, Mdina
```

## Full Malta + Gozo locality list
All Maltese towns included in the gate — list in `src/trigger/job-hunt/config.ts::MALTA_LOCALITIES`.

Notable iGaming clusters:
- **Ta' Xbiex, Sliema, St Julian's, Paceville, Swieqi** — majority of operators
- **Msida, Pietà, Gżira** — payments, affiliate agencies
- **Qormi, Birkirkara** — fintech, insurance

## Gotchas
- Accent variants: write both `Mellieħa` and `Mellieha` — the normalizer strips accents but raw scraped text may use either
- `Rabat` is ambiguous (Malta has Rabat near Mdina, Gozo has Rabat = Victoria). Score weights them the same.
- `Mġarr` (Malta, north) vs `Mġarr, Gozo` (ferry port). Jobsplus data sometimes omits the Gozo suffix.

## When editing
- Add a new locality → append to `MALTA_LOCALITIES`. Optionally add to `DRIVE_30MIN` if commute-friendly.
- Remove noise → if a gate passes a non-Malta match, check the regex word boundary — "mt" matches "mt" but also words like "amount" in theory. Current implementation uses `\b(malta|mt)\b` on accent-stripped lowercase text, which is safe.
