# Plugin TouteMonAnnée (cahier de texte, cahier de liaison, publications)

> Dernière mise à jour : 2026-10-06
> Sources : `apps/server/src/plugins/toutemonannee/{index,client,mapping,store}.ts`, tests `apps/server/src/plugins/toutemonannee/plugin.test.ts`, `apps/web/src/views/SchoolView.vue`, `apps/web/src/components/SchoolLinkCard.vue`, `apps/web/src/stores/school.ts`, `apps/web/src/lib/school.ts` (+ `school.test.ts`), `apps/web/src/api/{transport,httpTransport,mockTransport,mockSchool}.ts`, `apps/web/src/components/ui/Segmented.vue`

## Ce que c'est

L'école sur [toutemonannee.com](https://www.toutemonannee.com) : le **cahier de texte**
(devoirs), le **cahier de liaison** (messages de l'enseignante) et les **publications** de la classe,
réunis dans une vue **École** (`/school`, rail après Agenda). Demande de l'utilisateur, 2026-10-04 :
le site oblige à cliquer jour par jour sur un calendrier, sans vue d'ensemble ; la vue doit servir
aux parents COMME à l'élève — pas de « gros texte » ni d'interface enfantine, la même taille que le
reste de Kasbah, le prochain jour à rendre mis en avant par le style.

Plugin **sans appareil** comme Agenda (`3_22_agenda.md`) : `discover` → `[]`, `execute` refuse en
`UNSUPPORTED_COMMAND`, la vue interroge les routes propres.

## L'API : privée, relevée dans le navigateur

Aucune API publique. Celle de l'appli web du site (Laravel) a été relevée le 2026-10-04 dans la
preview, sur le compte de l'utilisateur, en lecture seule, plus deux gestes faits PAR l'utilisateur
(cocher / décocher) pour voir l'écriture.

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/connect/check-email-username` | JSON `{ username }` → `is_username_or_email_used` |
| `POST` | `/connect/signin` | multipart `username`, `password`, `remember=1` |
| `GET` | `/spaces/list` | les espaces du compte ; `type: 1` = cahier de texte d'une classe, `uuid`, `display_name` (nom de la classe), `for_students`, `in_scope` ; l'année passée dans `spaces_soon_archived` |
| `GET` | `/journal/<uuid>/events/list?page=` | devoirs À VENIR (aujourd'hui compris), 10 par page, `last_page` |
| `GET` | `/journal/<uuid>/events/list?date=AAAA-MM-JJ&page=1` | les devoirs d'un jour (passé compris) |
| `GET` | `/journal/<uuid>/events/counters?date=` | nombre d'entrées par jour du mois (non utilisé) |
| `PUT` | `/journal/<uuid>/events/acknowledge/<id>` | la case « fait » du site : **BASCULE**, corps vide ; rend `{ reason, event }` à jour |
| `GET` | `/journal/<uuid>/transmissions/list?page=` | cahier de liaison ; `has_acknowledged` / `can_acknowledge` (« j'ai lu »), `can_answer`, `responses_count` |
| `GET` | `/journal/<uuid>/posts/list?published_date_order=1&page=` | publications : `model: post` (annonces, `files`, `comments_count`) mêlées de `model: reminder` (rappels générés « Demain », anniversaires) — écartés |

Points relevés :

- **Session = cookies** (le cookie de session Laravel, `XSRF-TOKEN`, et `remember_web_<hash>` posé par
  `remember=1`). Aucun en-tête n'est exigé en lecture ; sans session valide, la route **redirige
  vers `/connect`** (302) — c'est ainsi qu'une session perdue se détecte.
- Les écritures portent `x-csrf-token` (jeton de la page), `x-requested-with: XMLHttpRequest`,
  `x-requested-from: Reactor`. Le client envoie aussi `X-XSRF-TOKEN` = cookie `XSRF-TOKEN` décodé,
  que Laravel accepte quand `X-CSRF-TOKEN` manque ; un `419` fait relire le jeton (`/dashboard`) et
  rejouer une fois. **Non vérifié sur le site au moment de l'écriture** : la liaison réelle a réussi
  le 2026-10-04 (donc `check-email-username` et `signin` passent), le cochage réel n'a pas été rejoué.
- **Les champs `ack_*` d'un devoir ne sont PAS une signature des parents** (première lecture
  fausse) : c'est la case « Cliquez pour marquer cette leçon comme faite » que l'enseignante ouvre
  sur certaines leçons (`ack_needed`). `acks_count` = élèves concernés, `acks_validated_count`
  = ceux qui ont coché ; elle voit qui l'a fait.
- `date` d'un devoir = le jour où c'est **à rendre**. Les dates des messages et publications
  arrivent en `{ day: "08", month: "Sept.", year, hours, minutes }`, mois abrégé en français
  (`detailedToLocal`).
- Le niveau n'est **pas** dans les données (un seul destinataire pour une classe à plusieurs
  niveaux) : il est écrit dans le texte (« pour les cm1 », « CM2 : »). `levelsIn` le lit (CP, CE1, CE2, CM1, CM2) ;
  une entrée sans niveau parle à toute la classe.
- Les publications d'école arrivent dans chaque classe destinataire : dédoublonnées par `id`.

## Liaison : le mot de passe ne sert qu'une fois

Même principe que MELCloud (`3_13_mitsubishi-melcloud.md`) : la carte des Réglages
(`SchoolLinkCard.vue`) envoie identifiant et mot de passe à `POST /login`, le serveur se connecte,
**garde les cookies** dans `.state/toutemonannee.json` (droits 0600, `TMA_FILE`) et oublie le mot de
passe. Le cookie `remember_web_…` rouvre seul une session Laravel expirée : pas de reconnexion
automatique nécessaire. Si le site renvoie malgré tout vers `/connect`, le plugin passe
`sessionLost` (santé `needs_pairing`, bandeau dans la vue, formulaire réaffiché) et **garde la
dernière lecture**.

Le site tourne ses cookies : chaque `Set-Cookie` est réécrit dans le fichier d'état (`onCookies`).

## Lecture

Toutes les `TMA_REFRESH_MS` (30 min, 5 min au moins) : `spaces/list` → pour chaque cahier de
texte en cours, les devoirs à venir (5 pages au plus), les `TMA_PAST_DAYS` derniers jours (7 ; une
requête par jour), le cahier de liaison (3 pages), les publications (2 pages). Le texte vient de
`content.raw` ; le HTML (publications) est ramené à du texte (`htmlToText`) — **jamais** injecté
dans l'interface. Un échec garde la lecture précédente (`degraded`).

## La case « fait »

- Devoir dont l'enseignante a ouvert la case (`ack_needed && can_ack` → `siteAck`) : c'est **celle
  du site**. Comme la requête bascule, le serveur relit d'abord la journée (`list?date=`), ne
  bascule que si l'état diffère, puis vérifie `has_acknowledged` dans la réponse — deux clics
  rapprochés ou deux écrans ne s'annulent pas (test « ticks the site's own box only when its state
  differs »).
- Sinon : gardée dans Kasbah (`done: number[]` du fichier d'état).

## Routes (`/api/plugins/toutemonannee/…`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/status` | `{ linked, username, sessionLost, fetchedAt, error }` |
| `GET` | `/school` | tout : statut + `journals`, `homework`, `messages`, `posts`, `filters`, `postsSeen` |
| `POST` | `/login` | `{ username, password }` → `school` ; `401 NEEDS_PAIRING` si refusé, `502` sinon |
| `POST` | `/logout` | cookies effacés ; filtres et cases locales gardés |
| `POST` | `/refresh` | relit tout maintenant |
| `PUT` | `/homework/:journal/:id/done` | `{ done }` ; `404` si le devoir n'est pas dans la lecture |
| `PUT` | `/filters` | `{ hiddenJournals, hiddenLevels }` — gardés par le serveur, partagés par tous les écrans |
| `PUT` | `/posts/seen` | `{ id }` : la plus récente publication vue (ne recule jamais) |

Toutes les écritures rendent la forme de `/school`.

## Vue École

- Barre unique : filtres (classes si plusieurs, niveaux) à gauche ; à droite « Mis à jour à HH:MM »
  (texte discret qui sert aussi de bouton de mise à jour — la relecture est automatique, le geste
  manuel ne doit pas attirer l'œil ; icône seule sous 520 px) puis un `Segmented` en **icônes**
  (`pencil`, `message`, `news`, nom en infobulle) avec pastille de compte.
- **Devoirs** : par jour à rendre, à partir d'aujourd'hui ; le prochain jour à rendre a son titre
  en accent et une étiquette pleine « demain » (l'utilisateur a refusé le liseré à gauche des
  cartes) ; « Afficher les N devoirs passés » replié — on compte des DEVOIRS : « 4 jours passés »
  se lisait comme 4 jours de calendrier alors qu'ils s'étalaient sur la semaine relue.
- **Liaison** : messages récents d'abord, « Non lu ». **Publications** : « Nouveau » au-delà de
  `postsSeen` (marqué vu à l'ouverture de l'onglet, l'étiquette reste pendant la visite), images en
  vignettes, documents en liens.
- Pastilles : devoirs non faits du prochain jour à rendre, messages non lus, publications
  nouvelles — après filtres (`lib/school.ts`, `badges`).
- La vue se fie à la réponse de `/school`, pas à l'inventaire des plugins : le mode simulé n'en
  expose aucun, et `mockSchool.ts` y sert une classe de démonstration.

## Pas encore fait

- « J'ai lu » d'un message de liaison : la requête n'a pas été capturée (les deux messages
  existants étaient déjà lus). À relever au prochain message, comme la case « fait ».
- Répondre à l'enseignante, commenter ou réagir à une publication : écritures visibles par des
  tiers, laissées pour une étape à part (décision du 2026-10-04).

### Mise à jour 2026-10-06 — lecture par le serveur MCP

L'outil `get_school` (`apps/server/src/mcp/server.ts`, page `../1_architecture/1_7_serveur-mcp.md`) lit `GET /api/plugins/toutemonannee/school` et en rend un condensé
(`schoolDigest`) : devoirs triés par date à rendre (à venir seulement, sauf `includePast`), messages de
liaison avec `read`, publications avec `new`, et `fetchedAt`. Il applique les filtres classes / niveaux
de la vue École, sauf `includeHidden`, et se limite à une `section` si on la demande. **Lecture seule** :
aucune écriture (case « fait », « j'ai lu ») ne passe par le MCP. Compte non relié : l'outil répond en
erreur et renvoie vers la vue École.
