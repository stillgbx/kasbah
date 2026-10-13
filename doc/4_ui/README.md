# 4 — UI

> Dernière mise à jour : 2026-10-13
> Catalogue de la section : source unique de sa liste de pages, d'où `scripts/wiki-index.mjs` génère le bloc `4_ui` de [`index.md`](../index.md). Historique de la section : `Grep 4_ui/` dans [`log/`](../log/README.md).

Un résumé dit **ce que couvre** la page, en 350 caractères au plus, jamais ce qui a changé : l'historique
vit dans la page (sections datées) et dans le journal.

<!-- catalogue:begin -->
Interface : langage visuel, navigation et panneaux de la vue Maison, thèmes et langues, puis une page par famille de vues.

### Socle

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [4_0 Langage visuel](4_0_langage-visuel.md) | Maquette de référence, jetons et primitives CSS, règle « rien ne doit bouger » (`PulseDot`, `MarqueeText`, emplacements réservés), jeu d'icônes trait, couleurs Vuetify, palette de la scène 3D, pilules de marqueur. | 2026-10-06 |
| [4_1 Navigation et panneaux](4_1_navigation-et-panneaux.md) | Grille, rail, en-tête et barre du bas, vue Maison immersive (panneaux maison → pièce → appareil, ambiances, mode « déplacer », emplacement), recherche et palette Ctrl+K, assistant, téléphone, alertes du rail, banc de réglage de la lumière ; renvoie aux pages des autres vues. | 2026-10-13 |
| [4_2 Thème et langues](4_2_theme-et-langues.md) | Apparence clair / sombre / système, thèmes nommés déclarés dans `src/themes/` et dérivés pour Vuetify, persistance des réglages, i18n fr / en (vocabulaires d'ouvrant, neutralité de genre, pluriels). | 2026-10-06 |

### Vues

| Page | Résumé | Dernière mise à jour |
|---|---|---|
| [4_3 Vues Lumières, Ouvrants et Caméras](4_3_vues-lumieres-ouvrants-cameras.md) | Vues en bandes par niveau (`RoomBands`), pièces réordonnables, interrupteurs maîtres, contrôles d'ouvrant (vocabulaires, position inconnue, position favorite, vignette verticale), volets solaires, cartes et tuiles caméra avec leur vidéo. | 2026-10-13 |
| [4_4 Vues Énergie et Véhicules](4_4_vues-energie-vehicules.md) | Vue Énergie (schéma de flux, onduleurs, champs de panneaux, tuiles par voiture) et vue Véhicules : carte du véhicule, carte plan / satellite, réveil, charge et limite, climatisation, logiciel, apparence. | 2026-10-13 |
| [4_5 Musique et médias](4_5_musique-et-medias.md) | Vue Médias et lignes de lecteur (diffusion, direct, barre de son), panneau et barre du lecteur, page Musique : sources (YouTube Music, radios, Mixcloud), recherche, file d'attente, genres, détail d'album, lecture dans le navigateur. | 2026-10-13 |
| [4_6 Autres vues](4_6_autres-vues.md) | Vues d'un domaine : Météo (radar, autre lieu, tendance, lune, vigilance), Robots (tondeuse, aspirateur, journal, zones, carte), Eau, Chauffage, Animaux, Agenda, École, Courses, Automatisations. | 2026-10-13 |
| [4_7 Vue Réglages](4_7_reglages.md) | Organisation de la vue Réglages, carte Plugins (un interrupteur par fabricant, sous-items), grille de thèmes, carte Rendu 3D, entrées locales au poste, carte Comptes, « Caler sur la photo ». | 2026-10-13 |
| [4_8 Mode édition et propriétés](4_8_mode-edition-et-proprietes.md) | Mode édition de la maison : ouvertures et menuiserie, places de stationnement, fenêtres de toit, jardin, contour du terrain et cadastre, relief, apparence et dimensions des pièces, pièces et niveaux ; propriétés et démos. | 2026-10-13 |
<!-- catalogue:end -->
