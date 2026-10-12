---
name: publish
description: >-
  Livre un point propre du travail de la session : vérifie (tests, typecheck, lint) selon le diff,
  met à jour le wiki `doc/`, le README et les pages `docs/` (plugins, format maison) si le
  changement les concerne, passe l'analyse GitNexus, commite et pousse sur main. À utiliser quand
  l'utilisateur dit « publie », « livre », « on livre », « commit et push », « c'est bon, pousse », à la fin
  du sujet demandé, ou quand une étape intermédiaire est prête à partir. Ne livre que les fichiers
  de la session : le dépôt est partagé avec d'autres sessions et il est PUBLIC.
---

# Publish

L'appel du skill vaut accord pour commiter et pousser. On ne redemande rien, sauf si une étape
trouve un problème : un fichier dont on ne sait pas à qui il est, un test rouge, un risque GitNexus
HIGH ou CRITICAL, un push refusé. Dans ce cas, on s'arrête et on demande.

Argument facultatif : un résumé du sujet, à utiliser dans le message de commit.

## 1. Portée : les fichiers de cette session

```bash
git status --porcelain
git diff --name-only
git log origin/main..HEAD --oneline
```

- **On garde** les fichiers que cette session a modifiés ou créés (on le sait par la conversation).
- **On laisse** les fichiers modifiés que la session n'a pas touchés : ils sont à une autre session
  qui travaille en même temps. On ne les indexe pas, on ne les annule pas, on ne les « range » pas.
  On les cite dans le compte rendu.
- **On ne sait pas** (skill appelé dans une session neuve, fichier modifié des deux côtés) : on
  montre la liste et on demande.
- Les fichiers non suivis que la session n'a pas créés restent hors de l'index, en particulier
  `house/` (sauvegardes de la vraie maison).
- Des commits locaux qui ne viennent pas de cette session (`origin/main..HEAD`) partiront avec le
  push : on les cite avant de pousser.

Rien à livrer : on le dit et on s'arrête.

## 2. Vérifier, selon le diff

| Le diff touche | À lancer |
|---|---|
| uniquement `doc/`, `docs/`, `README.md`, `*.md` | rien |
| du code (`apps/`, `packages/`, `scripts/`, configs) | `npm test`, `npm run typecheck`, `npm run lint` |

Avant un commit, la suite est complète (environ 2 min pour les trois). Les trois commandes se
lancent dans le même message, en parallèle.

Le seul raccourci : si les trois ont déjà tourné dans la session, sont passés au vert, et que
**rien n'a changé depuis** dans le code (`git diff --stat` identique), on ne les relance pas et on
le dit dans le compte rendu.

En cas d'échec :

- relancer d'abord le fichier fautif seul (`npx vitest run <fichier>`) : un échec intermittent a
  déjà été vu ;
- un échec dans un fichier d'une autre session ne bloque pas la livraison, mais on le signale ;
- un échec dans nos fichiers : on corrige, on ne relance que ce qui a échoué et ce que le correctif
  touche, puis on reprend. Si la correction n'est pas évidente, on s'arrête et on demande.

Interface : si le diff change ce que l'écran affiche et que l'utilisateur n'a pas validé le rendu
dans la session, on propose en une ligne un passage de `relecteur-ui` (s'il existe), sans le
lancer d'office.

## 3. Le wiki `doc/`

On met à jour le wiki quand le diff apporte du savoir : fonctionnalité, correctif qui révèle un
piège, refactor, changement de schéma, de protocole, de configuration ou de mise en production. On
ne le fait pas pour un renommage, une coquille ou un réglage de style : le wiki n'est pas un
journal des commits.

- Une ou deux pages, contexte en main : invoquer le skill `wiki-update` dans le fil principal.
- Plusieurs pages, ou contexte chargé : déléguer à l'agent `scribe` s'il existe, en lui donnant le
  diff, l'intention et ce qui a été écarté.

`doc/index.md` (date de la page) et `doc/log.md` font partie de la mise à jour. Le wiki part
**dans le même commit** que le code.

## 4. README et pages `docs/`

Elles s'adressent à l'utilisateur de Kasbah, pas au développeur. On les retouche seulement si ce
qu'elles promettent a changé :

| Le changement | À mettre à jour |
|---|---|
| nouveau plugin | `docs/plugins/<id>.md` (même gabarit que les autres) + ligne du tableau **Plugins** du README |
| ce que fait un plugin, sa connexion, sa mise en route, ses variables | `docs/plugins/<id>.md` ; tableau du README si l'accès ou les kinds changent |
| nouvelle variable d'environnement | `apps/server/.env.example`, la page du plugin, section **Configuration** du README si elle est générale |
| nouvelle vue ou fonction visible | README, **Fonctionnalités** (tableau des vues, scène 3D, ambiances, automatisations) |
| outil MCP ajouté ou changé | README, **Serveur MCP** |
| format de la maison | `docs/house-json.md` |
| démarrage, scripts npm, production | README, **Démarrage** / **Qualité** |

Règles : une ligne de tableau reste courte ; on garde le ton et le gabarit des pages voisines ; les
captures (`docs/screenshots/`) ne se refont que sur demande. Si le README ou la page est déjà
modifié par une autre session, on ne le touche pas et on signale ce qui resterait à y écrire.

## 5. Données personnelles

Le dépôt est public (CLAUDE.md §7). Avant d'indexer, relire ce que la session a écrit dans le code,
les tests, les fixtures, `doc/`, `docs/` et le message de commit : ni prénoms, ni IP réelles, ni
adresse, ni identifiants d'appareil ou de compte, ni mesures réelles, ni plan de la vraie maison.
Les hooks `pre-commit` et `commit-msg` (`scripts/check-private.mjs`) refusent ce qu'ils
reconnaissent ; un refus se corrige en retirant la valeur, **jamais** par `--no-verify`.

## 6. GitNexus avant le commit

L'index se refait après le push (étape 9). Avant le commit, on regarde seulement si la ligne des
statistiques de `CLAUDE.md` et `AGENTS.md` (« indexed by GitNexus as kasbah (N symbols, N
relationships, N execution flows) ») est trop loin de l'index, sans lancer d'analyse :

```bash
node -e "const s=require('./.gitnexus/meta.json').stats;console.log(s.nodes,s.edges,s.processes)"
grep -n "indexed by GitNexus" CLAUDE.md AGENTS.md
```

Correspondance : symbols = `nodes`, relationships = `edges`, execution flows = `processes`. Ces
chiffres sont ceux de l'index de la livraison précédente : un temps de retard, sans importance.

- **Écart de plus de 10 %** sur l'un des trois : réécrire la ligne avec les chiffres de
  `meta.json`, dans les deux fichiers (Edit sur la ligne seule), et les ajouter au commit.
- **Sinon** : on ne touche pas aux deux fichiers.
- `CLAUDE.md` ou `AGENTS.md` déjà modifié par une autre session : on ne les touche pas, on le dit.

Ces chiffres ne pilotent rien (aucun outil ne les lit) : on ne fait pas d'analyse ni de commit
exprès pour eux. Le texte des règles de la section GitNexus ne change qu'avec une nouvelle version
de GitNexus : un `analyze` sans option lancé à la main le reprend.

Puis indexer, par chemins explicites (jamais `git add -A` ni `git add .`) :

```bash
git add <fichiers de la session>   # + CLAUDE.md AGENTS.md si la ligne a été réécrite
git status --porcelain
```

Puis l'analyse des changements indexés : `detect_changes({scope: "staged"})` par le MCP, ou
`node .gitnexus/run.cjs detect-changes --scope staged --repo .`.

- `partial: true` ou `truncated: true` : relancer, ce n'est pas un résultat propre.
- Risque HIGH ou CRITICAL : on s'arrête, on montre les symboles et les flux touchés, et on demande.
- Risque `UNKNOWN` : pas un feu vert ; le dire dans le compte rendu.
- Des symboles ou des flux touchés qui n'ont rien à voir avec le sujet : un fichier étranger s'est
  glissé dans l'index, revenir à l'étape 1.

## 7. Commit

Le message suit l'usage du dépôt, en français, écrit dans un fichier temporaire du scratchpad puis
passé par `git commit -F <fichier>` (le hook `commit-msg` le relit) :

```
Domaine : ce qui change, en une phrase.

Ce qui a été fait et pourquoi, en paragraphes de prose, lignes d'environ 100 caractères.
Les choix qui ne se voient pas dans le code, ce qui a été écarté.

Vérifié … (tests, mode simulé, vraie maison sans détail). Reste … s'il reste quelque chose.
Wiki : pages touchées.

Co-Authored-By: <ligne d'attribution donnée par la session>
```

- `Domaine` = le plugin, la vue ou la zone (« Tondeuse », « Transcription », « Scène 3D »…).
- Une étape intermédiaire se dit comme telle (« première partie », « Reste : … »).
- Un sujet = un commit. Deux sujets sans rapport dans le diff de la session : deux commits.

Hook refusé : lire la sortie, corriger, réindexer, refaire un **nouveau** commit (pas d'`--amend`
sur un commit qui n'a pas eu lieu).

## 8. Push sur main

On pousse sur `main` et rien d'autre ; la branche d'un worktree ne part jamais sur origin.

```bash
git fetch origin
git log HEAD..origin/main --oneline
```

- **Rien de nouveau sur origin** : `git push origin HEAD:main`.
- **Origin a avancé** : `git rebase origin/main`, relancer les tests si le rebase a touché nos
  fichiers, puis `git push origin HEAD:main`. Si le rebase est refusé parce que d'autres sessions
  ont des modifications en cours dans le même checkout, on ne fait ni `--autostash` ni `stash` :
  on s'arrête et on demande.
- **Dans un worktree** : après le push, avancer le checkout principal
  (`git -C <checkout principal> merge --ff-only origin/main`) et vérifier son `git log -1`.
- Push refusé : on ne force jamais (`--force` interdit sur main).

## 9. GitNexus après le push

L'index est lié au commit : après chaque commit, le hook le signale périmé. On le refait une fois,
au premier plan (environ 2 min), sans toucher à `CLAUDE.md` ni `AGENTS.md` :

```bash
node .gitnexus/run.cjs analyze --index-only
```

Une autre session est en train d'analyser : attendre qu'elle ait fini, pas deux analyses à la fois.

## 10. Compte rendu

Court, dans la réponse (pas de fichier) :

- le commit (hash court, titre) et le push (`main` à jour) ;
- vérifications : jouées (vert), non requises (diff de doc), non jouées (et pourquoi) ;
- pages mises à jour (wiki, README, `docs/`) ou « rien à documenter » ;
- GitNexus : résultat de `detect_changes` (risque, flux touchés), ligne des statistiques
  réécrite ou non (écart mesuré), index refait après le push ;
- fichiers laissés de côté parce qu'ils sont à une autre session ;
- si du code serveur a changé : le serveur de l'utilisateur ne tourne pas en mode watch, il faut le
  redémarrer, une fois le checkout principal à jour.
