# SCHEMA — conventions du wiki

Wiki narratif du projet **Kasbah** (app web 3D — tablette, ordinateur, téléphone — pour la maison connectée).
Maintenu par les skills `wiki-update` / `wiki-query` / `wiki-lint`.

## Langue

**Français** (le projet et les commentaires de code sont en français). Le code, les
identifiants et les chemins restent tels quels.

## Arborescence

```
doc/
  SCHEMA.md          ce fichier (conventions — à lire en premier)
  index.md           catalogue de toutes les pages (titre + résumé + date)
  log.md             journal des ingest / update / lint (plus récent en haut)
  0_overview/        vision, principes, glossaire
  1_architecture/    monorepo, contrat partagé, serveur, protocole, app web, scène 3D
  2_maison/          format house.json, géométrie (murs, ouvertures, toit), jardin
  3_plugins/         simulation, Philips Hue, écrire un plugin, fabricants à venir
  4_ui/              langage visuel, navigation et panneaux, thème et langues
  5_setup/           installation, configuration .env, production
  6_faq/             pièges rencontrés et recettes (une entrée = un incident)
```

Les pages de référence lisibles par un humain non développeur restent dans `docs/`
(ex. `docs/house-json.md`, format du fichier maison) : le wiki les cite, ne les duplique pas.

## Nommage des pages

`N_M_titre-en-kebab.md` dans un dossier de section `N_nom-section/` :
- `N` = numéro de section (cohérent avec le dossier),
- `M` = ordre de la page dans la section.

Ex. `1_architecture/1_2_serveur-et-plugins.md`.

## En-tête de page

Chaque page commence par :

```markdown
# Titre de la page

> Dernière mise à jour : AAAA-MM-JJ
> Sources : `chemin/fichier.ts`, `README.md`, commit abc123…
```

## Règles de rédaction

- **Compléter, jamais écraser** : pour une révision, ajouter une sous-section datée
  `### Mise à jour AAAA-MM-JJ — titre` plutôt que réécrire.
- **Citer les sources** : fichiers de code (chemin relatif au dépôt), variables
  d'environnement, routes, commits.
- **Contradiction** : ne pas supprimer l'ancienne version ; ajouter une section
  `### Contradiction détectée AAAA-MM-JJ` et demander arbitrage.
- Les liens entre pages du wiki sont relatifs **au dossier de la page qui les porte**. Depuis
  une page de section, une page d'une autre section s'écrit donc
  `../2_maison/2_0_format-house-json.md` — chemin donné ici en **exemple**, il n'est pas à
  résoudre depuis ce fichier, qui est à la racine de `doc/`.
  Les fichiers de code sont cités en `backticks` (chemin relatif au dépôt), pas en lien.
- Pages FAQ : format **Date / Symptôme / Diagnostic / Solution**.
- **Aucune donnée personnelle** : le dépôt est public. Ni prénom ni surnom d'appareil, ni IP, domaine ou
  GPS réels, ni plan de la vraie maison (pièces, orientations, dimensions, nombre d'appareils), ni
  identifiant d'appareil ou de compte, ni mesure réelle datée, ni famille, école ou santé. On écrit
  « vérifié sur la vraie maison » sans les détails, et un « Déclencheur » de `log.md` paraphrase la
  demande quand elle en contient. Règle complète : `CLAUDE.md` §7 ; garde-fou : `scripts/check-private.mjs`.

## Pages hors index (légitimes)

`SCHEMA.md`, `index.md`, `log.md`. Le dossier `_generated-ai-doc/` (ignoré par git) sert aux
notes éphémères de session, pas au wiki.

## Wiki vs GitNexus

- **Wiki** = connaissance narrative (pourquoi cette architecture, décisions, recettes).
- **GitNexus** = intelligence de code (mécanique : qui appelle X, rayon d'impact).
  Mise à jour : `npx gitnexus analyze` après des commits importants.
