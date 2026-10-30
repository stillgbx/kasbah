# 2 — Maison

> Dernière mise à jour : 2026-10-13
> Catalogue de la section : source unique de sa liste de pages, d'où `scripts/wiki-index.mjs` génère le bloc `2_maison` de [`index.md`](../index.md). Historique de la section : `Grep 2_maison/` dans [`log/`](../log/README.md).

Un résumé dit **ce que couvre** la page, en 350 caractères au plus, jamais ce qui a changé : l'historique
vit dans la page (sections datées) et dans le journal.

<!-- catalogue:begin -->
La maison décrite en JSON : format et validation, géométrie dérivée (murs, ouvertures, sols, toit), jardin.

### Pages

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [2_0 Format house.json : décisions et validation](2_0_format-house-json.md) | Décisions derrière le format (repère, sens des polygones, ancres, liaison `deviceId`, scènes), validation, relevé métré, géoréférencement et origine, placement d'un appareil, toit et champs de panneaux, section `plugins`, écritures depuis l'UI (JSON patché), index `lookup.ts`. | 2026-10-30 |
| [2_1 Géométrie : murs, ouvertures, sols, toit](2_1_geometrie.md) | Algorithme des murs sans CSG (classification, mitres, découpe des ouvertures, arbitrage aux angles et aux T façade / cloison), sols, terrain et relief, toit, bornes, géométrie d'édition, invariants testés. | 2026-10-29 |
| [2_2 Jardin : arbres, buissons, pierres](2_2_jardin.md) | Végétation posée à la main dans `site.garden[]` : format, REST et store, planter / régler / glisser, style low-poly facetté procédural et pistes écartées, espèces en recettes JSON, saisons, ombres et rendu. | 2026-10-06 |
<!-- catalogue:end -->
