# Notifications push (Web Push)

> Dernière mise à jour : 2026-10-28
> Sources : `packages/shared/src/push/push.ts`, `apps/server/src/core/push/{webpush,service,alerts,texts}.ts`, `apps/server/src/http/push.ts`, `apps/server/src/core/outbound.ts`, `apps/server/src/core/automations/runner.ts`, `apps/server/src/app.ts`, `apps/web/public/sw.js`, `apps/web/src/stores/push.ts`, `apps/web/src/components/settings/PushCard.vue`, tests `apps/server/src/core/push/push.test.ts` et `core/automations/runner.test.ts`, arbre de travail NON COMMITÉ du 2026-10-28 (après 610eff3)

## Ce que c'est, et pourquoi ce choix

L'app envoie des notifications au bureau et au téléphone, même fenêtre fermée : les **alertes de la
maison** (tondeuse en défaut, plugin en panne…) et les **messages des automatisations** (action
« Envoyer une notification »). Le serveur est l'émetteur ; l'écran n'a qu'à s'abonner.

- **Web Push, pas ntfy.** ntfy a été proposé en alternative (appli tierce, serveur de plus à
  tenir) ; l'utilisateur a pris Web Push, qui ne demande rien d'autre que l'app déjà installée.
- **Aucune bibliothèque `web-push`.** Le chiffrement du message (RFC 8291, `aes128gcm`) et le jeton
  VAPID (RFC 8292) sont écrits avec `node:crypto` (`core/push/webpush.ts`). La vraie raison n'est pas
  le poids d'une dépendance : l'endpoint est une adresse **choisie par le navigateur**, donc par un
  client que l'on ne contrôle pas. Il faut l'envoyer par `publicFetch` (`core/outbound.ts`, garde
  anti-SSRF : adresses publiques seulement), ce que la bibliothèque ne permet pas.
  `publicFetch` accepte pour cela `method: 'POST'` et `body`, et l'envoi se fait en
  `redirect: 'error'` : une redirection suivie renverrait le corps chiffré ailleurs.
- **Le service worker n'affiche que ce qu'il reçoit.** Les textes sont donc écrits **par le serveur**,
  en français ou en anglais selon la langue que l'écran déclare à l'abonnement
  (`core/push/texts.ts`, repris des libellés du panneau maison de `HomePanel.vue`).

## Le contrat (`packages/shared/src/push/push.ts`)

- `NOTIFY_CATEGORIES` : `vehicles`, `robots`, `pets`, `weather`, `plugins`, `automations`.
  `NOTIFY_CATEGORY_OF_KIND` rattache un kind à sa catégorie (`vehicle` → vehicles, `mower` et
  `vacuum` → robots, `weather`, `pet_feeder` et `pet_fountain` → pets) ; un kind absent de la table
  ne notifie jamais.
- Abonnement : endpoint HTTPS (2048 caractères au plus) et clés `p256dh` / `auth` en base64url.
- `PushMessage` : `{ title, body, tag, url }`. `tag` : un message de même tag remplace le précédent ;
  `url` : la page ouverte par un appui.

## Le serveur (`apps/server/src/core/push/`)

### `PushService` : un fichier, `.state/push.json`

Les clés VAPID **et** les abonnements vivent dans le même fichier : un abonnement est lié à la clé
publique avec laquelle il a été fait, les séparer ne mènerait qu'à des abonnements refusés.
Un abonnement porte : endpoint, clés, catégories, langue, compte (`req.sessionUser`, `null` sur le
réseau local) et date. Règles :

- **Fichier illisible = nouvelles clés**, et les écrans se réabonnent à leur prochaine ouverture.
- 50 abonnements au plus : le plus ancien cède la place (un écran réinstallé cent fois ne fait pas
  grossir le fichier).
- Le service de push répond 404 ou 410 : l'abonnement n'existe plus, il est effacé.
- Un abonnement d'un compte retiré de `mcp-users.json` est effacé **au prochain envoi** (voir
  `1_13_comptes-et-sessions.md`).
- TTL 24 h (une notification non livrée en un jour ne vaut plus rien), `Urgency: high`.
- `sub` du VAPID : `MCP_PUBLIC_URL`, sinon `mailto:kasbah@localhost`.

### `AlertNotifier` : la règle de l'app, un autre moment

La règle de ce qui est une alerte est celle de l'app (`deviceAlerts`, partagé ; règle des plugins de
`apps/web/src/stores/alerts.ts`). Seul le **moment** change : **une** notification quand une alerte
**apparaît**, pas à chaque état publié. Le piège est donc de ne pas renvoyer :

- **Ids déjà notifiés** gardés dans `.state/push-alerts.json` : un redémarrage ne renvoie rien.
- **Oubli à 10 min** (`FORGET_AFTER_MS`) : une alerte disparue depuis 10 minutes peut renotifier.
  Plus court, un état qui la fait clignoter (premier relevé partiel après redémarrage, message
  constructeur qui vacille) la renverrait deux fois.
- Un appareil dont l'état ne permet pas de dire (`deviceAlerts` rend `null`) **garde** ses alertes.
- Un appareil **sorti du registre** garde les siennes **7 jours** (`ABSENT_FORGET_MS`), choix de
  l'utilisateur : un plugin coupé puis rallumé ne renvoie pas ses alertes en cours, un appareil
  supprimé pour de bon ne reste pas dans le fichier.
- **Plugins** lus chaque minute par `host.health()` (la santé de la maison, pas celle d'un compte) :
  `error` et `needs_pairing` tout de suite, `degraded` après 5 min (`DEGRADED_GRACE_MS`, comme
  l'app : c'est souvent un raté passager).
- **Toutes les gravités partent, `info` comprise** (choix de l'utilisateur).

Titre = nom de l'appareil (ou « Plugin <id> ») ; `tag` = id de l'alerte ; `url` = la vue
(`/robots`, `/pets`, `/vehicles`, `/weather`, `/settings`).

### Action d'automatisation `notify`

Voir `1_8_automatisations.md` (mise à jour du 2026-10-28). Catégorie `automations`, titre = nom de
la règle, tag `automation|<id>`, url `/`.

## Routes (`apps/server/src/http/push.ts`)

Derrière la session comme le reste de l'API (détail dans `1_3_protocole-rest-ws.md`) :
`GET /api/push/key`, `PUT` et `DELETE /api/push/subscription`, `POST /api/push/test`.

## Le front

- **`apps/web/public/sw.js`** : sans cache, sans mode hors ligne, sans `fetch`. `push` →
  `showNotification` avec `renotify` quand il y a un tag (la même alerte remplace sa notification,
  et sonne encore). Appui → focus de la fenêtre ouverte et `postMessage` `kasbah:navigate`, que
  `stores/push.ts` route sans recharger l'app ; aucune fenêtre → `openWindow`.
- **`stores/push.ts`** : enregistrement du worker, abonnement, catégories en `localStorage`
  (`kasbah.push.categories`, toutes par défaut). L'abonnement est **renvoyé au serveur à chaque
  ouverture** et au changement de langue : cela porte un endpoint renouvelé, un abonnement que le
  serveur a perdu, et la langue des textes. Un abonnement fait avec une **autre clé** (état du
  serveur réinitialisé) est désabonné puis refait, sinon le service de push le refuse.
- **Carte Réglages « Notifications »** : voir `../4_ui/4_7_reglages.md`.
- Le mode simulé (`mockTransport`) répond `NOT_IMPLEMENTED` : pas de serveur, pas de service de push.

## Contraintes découvertes

- **Contexte sécurisé obligatoire.** Web Push ne marche que par l'adresse publique HTTPS (ou
  `localhost`), jamais par `http://<poste>:8787` depuis un autre écran ; la carte le dit. Sur
  iPhone, seulement l'app **installée sur l'écran d'accueil** (iOS 16.4 ou plus).
- Un écran qui s'abonne tard **ne reçoit pas** les alertes déjà en cours : elles sont déjà notifiées.
- `.state/push.json` contient la clé privée VAPID : il reste dans `.state/` (non versionné).

## Écarté

- **ntfy** (voir plus haut).
- **Destinataires par compte pour `notify`** : tous les abonnés de la catégorie, choix de l'utilisateur.
- **Interrupteur tout-ou-rien** : l'utilisateur a voulu choisir ses catégories.

## Vérification

Tests serveur (`push.test.ts`) : chiffrement vérifié en **déchiffrant comme un navigateur**, jeton
VAPID vérifié avec la clé publique, catégories et langue, 410, compte retiré, une seule notification,
pas de renvoi après redémarrage, oubli à 10 min et à 7 jours, plugins. `runner.test.ts` pour l'action.
Typecheck et lint globaux verts. Preview `kasbah-demo` : worker enregistré, clé servie, carte en fr
et en, 1440 et 375 px sans débordement, rien ne bouge entre activé / désactivé / refusé.

**Non joué** : un vrai abonnement et un vrai envoi jusqu'au téléphone (le navigateur intégré refuse
les notifications), thème sombre, zooms 1,25 et 1,5. Tant que cela n'a pas été fait, le chemin
complet jusqu'au service de push d'un navigateur réel n'est pas éprouvé : seul le chiffrement l'est,
par le test de déchiffrement.
