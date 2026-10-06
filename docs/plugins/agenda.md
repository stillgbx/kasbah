# Agenda

| | |
|---|---|
| **Id** | `agenda` |
| **Rôle** | agenda : les agendas Google de la famille, en lecture seule |
| **Connexion** | **cloud, officielle** : le flux iCal que Google publie pour chaque agenda, lu par le serveur |
| **Compte** | pas de connexion : une **adresse iCal secrète** par agenda, qui vaut mot de passe |
| **Vues** | Agenda, Réglages → Plugins |

## Ce que fait le plugin

- **Plusieurs agendas** réunis dans une seule vue, chacun avec sa **couleur** et son nom (agenda familial, jours fériés, agenda perso…). Pastille de couleur pour changer la couleur, flèches pour changer l'ordre, afficher ou masquer chaque agenda depuis la légende de la vue.
- **Vue Agenda** : le mois en cours à l'arrivée, avec la **semaine** et le **jour** à côté ; événements sur plusieurs jours, journées entières, lieu et description dans le détail d'un événement.
- **Récurrences** déroulées par Kasbah (événements qui se répètent, occurrences déplacées ou annulées, fuseaux horaires).
- **Lecture seule** : Kasbah n'ajoute ni ne modifie aucun événement.

Le plugin ne publie aucun appareil : il n'apparaît pas dans la maison 3D, et aucun outil de l'assistant (MCP) ne lit l'agenda.

## Connexion

Aucun compte Google n'est relié à Kasbah. Pour chaque agenda, Google fournit une **adresse secrète au format iCal** : le serveur la lit toutes les 10 minutes. Cette adresse **donne accès à l'agenda à quiconque la possède** : elle est gardée dans `apps/server/.state/agenda-calendars.json` (hors dépôt, hors `.env`), ne s'affiche plus après l'ajout et ne ressort jamais par l'API.

Si Google ne répond plus, la dernière lecture reste affichée avec un avertissement (« ne répond pas : dernière lecture affichée »).

## Mise en route

1. Cocher **Agenda** dans **Réglages → Plugins**. Tant qu'aucun agenda n'est relié, le plugin est « Appairage requis » et sa section s'ouvre seule.
2. Récupérer l'adresse iCal : dans **Google Agenda sur ordinateur**, avec le compte qui porte l'agenda (Google ne la montre qu'à son propriétaire, peut-être aussi à ceux qui peuvent le modifier) : **Paramètres** → l'agenda dans la colonne de gauche → **Intégrer l'agenda** → **Adresse secrète au format iCal**.
3. Dans la section Agenda de Réglages → Plugins, coller l'adresse dans **Ajouter un agenda**, ajouter si besoin un nom (sinon celui de l'agenda), puis **Ajouter**. Le flux est lu tout de suite : une adresse illisible est refusée et n'est pas gardée.
4. Répéter pour chaque agenda. Une adresse déjà ajoutée est refusée.
5. Ouvrir la vue **Agenda**.

Retirer un agenda : **Retirer**, puis **Confirmer le retrait**. Une adresse `webcal://` est acceptée.

## Configuration (`apps/server/.env`)

| Variable | Défaut | Rôle |
|---|---|---|
| `AGENDA_FILE` | `.state/agenda-calendars.json` | Fichier des agendas (adresses secrètes comprises) |
| `AGENDA_REFRESH_MS` | `600000` (10 min) | Relecture des flux, 1 minute au moins |

## Limites

- **Lecture seule** : écrire demanderait de passer par l'API Google Calendar (projet Google Cloud, autorisation OAuth), pas par l'adresse iCal.
- Le flux iCal peut accuser un petit retard sur Google ; un changement n'apparaît qu'à la lecture suivante du serveur (10 min par défaut).
- Une période affichée ne peut pas dépasser environ deux mois (la vue mois en couvre six semaines).
- Pour un agenda public (jours fériés), le flux public d'un agenda Google fait aussi l'affaire.

## Pour aller plus loin

Fonctionnement interne, lecture des récurrences et routes : [wiki, Agenda](../../doc/3_plugins/3_22_agenda.md).
