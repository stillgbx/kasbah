# SCHEMA — conventions du wiki

Wiki narratif du projet **Kasbah** (app web 3D — tablette, ordinateur, téléphone — pour la maison connectée).
Maintenu par les skills `wiki-update` / `wiki-query` / `wiki-lint`.

## Langue

**Français** (le projet et les commentaires de code sont en français). Le code, les
identifiants et les chemins restent tels quels.

Depuis le 2026-10-20, la vitrine du dépôt public (`README.md`, `docs/`) et les messages de commit
sont en anglais ; le wiki, lui, reste en français (`5_setup/5_0_installation-et-scripts.md`,
mise à jour du 2026-10-20). Les commentaires du code sont passés en anglais le même jour : la
parenthèse ci-dessus ne vaut plus pour eux. Il cite les sections de `docs/` et du README sous leur titre anglais.

## Arborescence

```
doc/
  SCHEMA.md          ce fichier (conventions — à lire en premier)
  index.md           catalogue de toutes les pages (titre + date, généré par section)
  log.md             journal des ingest / update / lint du mois en cours (plus récent en haut)
  log/               mois échus du journal (AAAA-MM.md) et leur catalogue README.md
  N_section/README.md  catalogue de la section : résumé de chaque page (source de l'index)
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

Le numéro d'une nouvelle page se lit **sur le disque** (fichiers `N_*.md` du dossier, plus grand `M`
+ 1), jamais dans un tableau : un catalogue en retard donnerait un doublon.

## Index à deux niveaux

`index.md` est lu en entier à chaque `wiki-query` : il ne doit grossir qu'avec le nombre de pages, pas
avec l'historique. Migré le 2026-10-13 (150 Ko → 7 Ko).

- **Catalogue de section** : la liste des pages, avec leurs résumés, vit dans `N_section/README.md`,
  entre `<!-- catalogue:begin -->` et `<!-- catalogue:end -->`. Première ligne : la phrase
  d'introduction de la section (recopiée dans `index.md`, donc sans lien relatif) ; puis des groupes
  `### Nom`, chacun avec une table `Page | Résumé | Dernière mise à jour` (date pure dans la cellule).
  Pas de ` | ` dans un résumé.
- **Bloc généré** : `index.md` ne porte, par section, que le bloc écrit par `node scripts/wiki-index.mjs`
  (introduction, lien vers le README, titres et dates), entre `<!-- section:N_section:begin … -->` et
  `<!-- section:N_section:end -->`. **Ne jamais éditer ce bloc à la main** : éditer le catalogue, puis
  lancer le script. Il signale aussi pages absentes du catalogue, liens morts, résumés trop longs ou
  datés, dates de catalogue en retard sur l'en-tête de page.
- **Résumé** : ce que couvre la page, 350 caractères au plus. Jamais l'historique (« depuis le
  AAAA-MM-JJ », « remplacé le … ») : il vit dans la page (sections datées) et dans le journal. Un
  résumé ne se retouche que si le **périmètre** de la page change.
- **Nouvelle section** : créer `N_section/README.md` avec son catalogue, ajouter dans `index.md` un
  `## N — Nom` suivi des deux marqueurs vides (ordre numérique), lancer le script.

## Journal et archives

`log.md` ne garde que les entrées du **mois en cours**. Chaque mois échu est déplacé dans
`log/AAAA-MM.md` par `node scripts/wiki-log.mjs`, qui génère aussi le catalogue `log/README.md` et les
blocs `<!-- log-nav:… -->` (mois précédent / suivant) en tête et en pied de chaque fichier.

- **Archivage automatique** : tout skill qui écrit dans `log.md` lance le script juste avant. La
  décision est mécanique (une entrée d'un mois antérieur au mois courant est archivée), le script est
  idempotent et sans effet quand il n'y a rien à faire. Ne jamais déplacer d'entrée ni éditer un bloc
  `log-nav` à la main. Pour écrire une entrée, ne lire que le **haut** de `log.md`.
- **Fouiller plus loin** : les archives ne se lisent pas par défaut. Quand l'historique compte (quand,
  pourquoi, à la suite de quoi), `Grep` sur `doc/log/` puis lecture de la seule entrée trouvée ; la date
  de mise à jour d'une page indique le mois à ouvrir.
- **Entrées figées** : un renommage de page ne réécrit pas les entrées de `log.md` ni de `log/` ; ce
  sont des enregistrements datés, pas des liens vivants.
- **Merges** : après résolution d'un conflit sur `log.md` ou `log/` (garder les deux côtés), relancer
  le script ; il renvoie les entrées revenues dans leur archive et ignore les doublons exacts.

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

`SCHEMA.md`, `index.md`, `log.md`, `log/*.md` (archives et leur catalogue), les `README.md` de section
(catalogues). Le dossier `_generated-ai-doc/` (ignoré par git) sert aux
notes éphémères de session, pas au wiki.

## Wiki vs GitNexus

- **Wiki** = connaissance narrative (pourquoi cette architecture, décisions, recettes).
- **GitNexus** = intelligence de code (mécanique : qui appelle X, rayon d'impact).
  Mise à jour : `npx gitnexus analyze` après des commits importants.
