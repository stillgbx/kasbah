# Plugin Agenda (agendas Google par adresse iCal secrète)

> Dernière mise à jour : 2026-10-09
> Sources : `apps/server/src/plugins/agenda/{index,ics,store}.ts`, tests `apps/server/src/plugins/agenda/plugin.test.ts`, `apps/server/src/plugins/index.ts`, `apps/server/.env.example`, `apps/web/src/views/AgendaView.vue`, `apps/web/src/components/agenda/{AgendaMonth,AgendaTimeGrid,AgendaEventDialog}.vue`, `apps/web/src/components/AgendaLinkCard.vue`, `apps/web/src/lib/agenda.ts` (+ `agenda.test.ts`), `apps/web/src/stores/agenda.ts`, `apps/web/src/api/{transport,httpTransport,mockTransport}.ts`

## Ce que c'est

Des agendas Google **partagés** (événements communs), affichés dans une vue Agenda :
le mois en cours à l'arrivée, semaine et jour à côté. **Lecture seule** pour l'instant (demande de
l'utilisateur, 2026-09-27). Plusieurs agendas, chacun avec sa couleur (agenda partagé, jours
fériés, agenda perso…).

Comme Radio (`3_19_radio.md`), c'est un plugin **sans appareil** : `discover` → `[]`, `execute`
refuse tout en `UNSUPPORTED_COMMAND`. La vue interroge ses routes propres.

## Pourquoi l'adresse iCal secrète, et pas l'API Google Calendar

Choix fait avec l'utilisateur le 2026-09-27, entre deux voies :

| | Adresse iCal secrète (retenue) | API Google Calendar (OAuth) |
|---|---|---|
| Mise en route | coller une adresse, 5 min | projet Google Cloud, client OAuth, liaison |
| Accès | lecture seule par nature | `calendar.readonly`, écriture possible plus tard |
| Récurrences | déroulées par Kasbah (`ical.js`) | déroulées par Google (`singleEvents`) |
| Piège | l'adresse vaut mot de passe | appli en mode « Test » → jeton expiré au bout de **7 jours** ; la passer « en production » (non vérifiée, avertissement à la liaison) |

Le **cookie de YouTube Music** (`3_16_ytmusic.md`) ne sert **pas** ici : c'est
une session de navigateur, pas un accès à l'agenda. Le compte Google qui PORTE
l'agenda est celui avec lequel on récupère l'adresse (Google Agenda sur ordinateur → Paramètres →
l'agenda → « Intégrer l'agenda » → « Adresse secrète au format iCal »). Google ne la montre qu'au
propriétaire de l'agenda (et peut-être à ceux qui peuvent le modifier — non vérifié).

**Pour écrire un jour**, il faudra passer à l'API : l'adresse iCal ne permet que de lire.

## Stockage : l'adresse ne ressort jamais

`store.ts` garde `{ calendars: [{ id, name, color, url }] }` dans `.state/agenda-calendars.json`
(`AGENDA_FILE`), écrit en `.tmp` + rename — hors dépôt et hors `.env`, comme le cookie YouTube
Music. L'`id` = 12 premiers caractères du SHA-1 de l'URL (ajouter deux fois = `409 ALREADY_EXISTS`).
Aucune route ne renvoie l'URL ; les messages d'erreur de lecture n'en contiennent pas non plus
(`HTTP 404`, `fetch failed`). Les tests le vérifient (`not.toContain('private-abc123')`).

`webcal://` est accepté et réécrit en `https://` (`normalizeUrl`) ; `http(s)` seulement.

## Lecture des flux

- Relus au démarrage puis toutes les `AGENDA_REFRESH_MS` (10 min par défaut, 1 min au moins) par
  `createPoller`. Un flux qui échoue **garde sa dernière lecture réussie** (l'agenda ne se vide pas)
  et porte `error` ; délai de 20 s par lecture.
- **À l'ajout**, le flux est lu tout de suite : une adresse qui ne se lit pas comme un VCALENDAR est
  refusée (`502 UPSTREAM_ERROR`) et n'est pas gardée. Le nom par défaut vient de `X-WR-CALNAME`.
- Santé : aucun agenda → `needs_pairing` (la section s'ouvre seule dans Réglages) ; un flux
  illisible → `degraded` avec son nom ; sinon `ok` « N calendars ».

## Déroulé des événements (`ics.ts`)

Confié à **`ical.js`** (Mozilla, dépendance ajoutée le 2026-09-27) — les récurrences sont tout le
piège du format :

- les `VTIMEZONE` jointes par Google sont enregistrées (`TimezoneService.register`) : sans elles,
  `TZID=Europe/Paris` serait lu comme une heure flottante ;
- une occurrence déplacée (`RECURRENCE-ID`) est rattachée à son maître **même si elle le précède dans
  le fichier** (`relateException` après coup) ; une exception en `STATUS:CANCELLED` est retirée ;
  `EXDATE` est gérée par l'itérateur ;
- itération bornée : `MAX_OCCURRENCES` = 20 000, arrêt 31 jours après la fin de la période (une
  occurrence déplacée peut y retomber) ;
- **journée entière** = dates locales `YYYY-MM-DD`, fin **exclue** (sans `DTEND` : un jour, RFC 5545)
  — jamais d'instant, sinon un anniversaire glisse d'un jour selon le fuseau. Rendez-vous = instants
  en ms ;
- id d'occurrence stable : `<calendarId>:<UID>:<RECURRENCE-ID d'origine>` ;
- description : le HTML léger de Google ramené à du texte (`<br>` → saut de ligne).

Les tests tournent aussi sous `TZ=America/New_York` : ils sont indépendants du fuseau de la machine.

## Routes (`/api/plugins/agenda/…`)

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/calendars` | `{ calendars: [{ id, name, color, fetchedAt, error }] }` — sans l'URL |
| `POST` | `/calendars` | `{ url, name?, color? }` : lu aussitôt, `400` / `409` / `502` |
| `PATCH` | `/calendars/:id` | `{ name?, color? }` (`#rrggbb`) |
| `PUT` | `/calendars/order` | `{ ids }` : nouvel ordre, **tous** les identifiants chacun une fois (sinon `400` — une liste partielle perdrait des agendas) |
| `DELETE` | `/calendars/:id` | retrait |
| `POST` | `/refresh` | relit tous les flux |
| `GET` | `/events?from=&to=` | occurrences de tous les agendas sur `[from, to[` (ms), **62 jours au plus** |

Couleur par défaut : la suivante de `AGENDA_COLORS` (même palette que la carte des Réglages).

L'ordre des agendas est celui du fichier `.state/agenda-calendars.json` : toutes les routes rendent
la liste dans cet ordre (ajout à la fin), et l'interface l'affiche tel quel.

## Côté interface

- **Réglages → Plugins → agenda** (`AgendaLinkCard.vue`, branchée dans `SETUP_CARDS` de
  `PluginSection.vue`) : liste des agendas (heure de lecture ou erreur), pastille de couleur qui
  ouvre la palette, retrait en deux appuis, formulaire d'ajout avec le chemin Google rappelé. Après
  chaque écriture, l'inventaire des plugins est relu (sinon le détail « 1 calendar » reste figé).
  Depuis le 2026-09-27, deux flèches (`chevronUp` / `chevronDown`, à gauche de « Retirer ») montent
  ou descendent un agenda d'un cran (`move` échange avec le voisin puis `PUT /calendars/order`) ;
  en bout de liste la flèche reste à sa place, grisée, et les flèches disparaissent sous deux agendas.
  La légende de la vue Agenda suit cet ordre.
- **Vue Agenda** (`/agenda`, entrée de rail `calendar` juste après Météo) : voir
  `../4_ui/4_1_navigation-et-panneaux.md`, section du 2026-09-27.
- Mode transport in-process (`mockTransport`) : les méthodes `agenda*` répondent `501`.

## Vérifié le 2026-09-27

Dans la preview : ajout par la carte du flux PUBLIC des jours fériés français de Google
(`fr.french#holiday@group.v.calendar.google.com/public/basic.ics`) → Toussaint et Armistice en
novembre 2026 ; un flux de test local (récurrences, chevauchements, journées multiples) ; adresse
injoignable refusée en `502`. Les deux agendas de test ont été retirés ensuite, le plugin est resté
activé dans la maison.

### Mise à jour 2026-10-09 — lu par le MCP (`get_agenda`)

Le plugin ne publie aucun appareil : rien ne passait par `list_devices`, et `docs/plugins/agenda.md` disait
qu'aucun outil de l'assistant ne lisait l'agenda (phrase corrigée le même jour). L'outil `get_agenda` (`from`,
`days` 1 à 62, défaut 7 jours depuis aujourd'hui) appelle `/calendars` puis `/events?from&to` par `app.inject`, au
nom du compte du jeton. Lecture seule, comme le plugin. Aucun agenda → `isError` qui dit d'en ajouter un ; les
agendas en échec sont listés dans `failing`. `agendaDigest` (pure) trie par début et nomme l'agenda ; pour une
journée entière, `date` + `until` = dernier jour **inclus**, parce que le flux iCal exclut la fin et qu'un agent la
lirait un jour de trop. Détail : `../1_architecture/1_7_serveur-mcp.md`. Non essayé sur le vrai serveur
(redémarrage nécessaire).

Sources : `apps/server/src/mcp/server.ts`.
