# 5 — Setup

> Dernière mise à jour : 2026-10-13
> Catalogue de la section : source unique de sa liste de pages, d'où `scripts/wiki-index.mjs` génère le bloc `5_setup` de [`index.md`](../index.md). Historique de la section : `Grep 5_setup/` dans [`log/`](../log/README.md).

Un résumé dit **ce que couvre** la page, en 350 caractères au plus, jamais ce qui a changé : l'historique
vit dans la page (sections datées) et dans le journal.

<!-- catalogue:begin -->
Installer, configurer et mettre en production.

### Pages

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [5_0 Installation et scripts](5_0_installation-et-scripts.md) | Prérequis, installation, scripts npm, versions épinglées et leurs raisons, preview Claude Code et sa pile séparée (`kasbah-mock`, ports), ffmpeg, textures CC0 (`scripts/fetch-textures.mjs`), GitNexus. | 2026-10-20 |
| [5_1 Configuration (.env)](5_1_configuration-env.md) | Où vivent les secrets, variables du serveur validées par zod (`config/env.ts`), variables par plugin, côté web. | 2026-10-24 |
| [5_2 Production](5_2_production.md) | Build web et bundle serveur esbuild, service statique et repli SPA, écran sur le LAN, app installable, accès extérieur par proxy inverse, bandeau de mise à jour, superviseur et mise à jour depuis Réglages (tâche planifiée Windows, service systemd). | 2026-10-24 |
<!-- catalogue:end -->
