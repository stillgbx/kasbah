# Appli Android Auto

> Dernière mise à jour : 2026-10-23
> Sources : `apps/android/app/src/test/kotlin/org/kasbah/auto/*Test.kt`, `apps/android/app/src/main/kotlin/org/kasbah/auto/{KasbahClient,MainActivity,KasbahCarAppService,AccessScreen,VoiceScreen,Voice,ProbeScreen}.kt`, `apps/android/app/src/main/AndroidManifest.xml`, `apps/android/app/build.gradle.kts`, `apps/android/dhu.cmd`, `apps/android/.gitattributes`, `apps/server/src/http/session.ts`, `apps/server/src/plugins/transcription/index.ts`, portail `developer.renaultgroup.com`, session du 2026-10-22 (essais sur un téléphone Android et dans le simulateur DHU), `apps/android/keystore.properties.example`, `apps/android/app/build.gradle.kts` (signature), console Google Play (2026-10-23)

Une appli Android, à côté de l'app web, qui met Kasbah sur l'écran de la voiture par **Android
Auto** : le portail et les portes de garage, un relevé de ce que la voiture transmet, et la voix de
l'assistant. Elle tourne **sur le téléphone** ; Android Auto l'affiche sur l'écran de la voiture.
Elle ne parle au serveur que par les routes déjà servies au site : **aucun changement serveur**.

Captures (maison de démonstration « Les Tilleuls », simulateur) : `docs/screenshots/android-auto-car.webp`,
`android-auto-car-action.webp`, `android-auto-phone-signin.webp`, `android-auto-phone-connected.webp`,
montrées dans `docs/android-auto.md`. Recadrées sur l'appli : la carte et la barre d'Android Auto
autour portaient la position réelle.

## Pourquoi Android Auto, et pas une appli dans la voiture

Le point de départ était de lire ce que l'API du constructeur ne donne pas (la pression des pneus de
la Renault 5, cf. [3_9 Renault](../3_plugins/3_9_renault.md)) avec une appli installée **dans** la
voiture (openR Link, Android Automotive). Écarté le 2026-10-22, pour trois raisons :

- **La permission** : sur le portail développeur de Renault (`developer.renaultgroup.com`, ex-
  `developer.ampere.cars`), `TIRE_PRESSURE` est lisible par une appli tierce via
  `Car.PERMISSION_TIRES_3P` (« dangerous », accordée par le conducteur). Mais ce `_3P` n'existe qu'à
  partir d'**Android Automotive 15** (plateforme openR evo). Avant, la seule permission est
  `PERMISSION_TIRES`, réservée au système et au constructeur. La R5 affiche **Android 12**.
- **La distribution** : une voiture à services Google n'installe que depuis le Play Store, sans
  mode développeur connu sur un véhicule de série.
- **L'émulateur R5** du portail simule openR Link (Android Automotive) : il ne sert qu'à une appli
  embarquée, pas à une appli projetée par Android Auto.

Deux autres pistes vues le même jour :

- **Le site dans le navigateur de la voiture** : Vivaldi est intégré à openR Link. Il marche
  **voiture à l'arrêt seulement** (règle Android pour tout navigateur embarqué) : bon pour consulter,
  pas pour ouvrir le portail en arrivant. Une appli « enveloppe » du site n'est pas possible dans
  Android Auto, qui n'affiche aucune page web.
- **Une carte à côté de la carte routière** : la colonne de droite d'Android Auto n'accepte que des
  widgets système (navigation, média, téléphone). Les widgets d'applis tierces sont annoncés, sans API
  publiée. Se déclarer appli média donnerait 3 boutons dans la carte média, mais à la place de la
  musique : écarté.

## Le projet `apps/android`

- **Kotlin**, Gradle 9.8 (wrapper), AGP 9.4 (Kotlin intégré, pas de plugin Kotlin à part),
  `compileSdk`/`targetSdk` 35, `minSdk` 29. Deux dépendances : `androidx.car.app:app` et
  `app-projected` 1.7.0. Ni OkHttp ni coroutines : `HttpURLConnection`, `org.json`, et un exécuteur
  à un fil (`Background` dans `KasbahClient.kt`).
- **Hors des workspaces npm** : pas de `package.json`, le monorepo ne le voit pas.
- **Catégorie `androidx.car.app.category.IOT`** (objets connectés) : celle qu'Android Auto prévoit
  pour « ouvrir la porte de garage ».
- **Installée à la main**, jamais par le Play Store : mode développeur d'Android Auto, « Sources
  inconnues ». D'où `HostValidator.ALLOW_ALL_HOSTS_VALIDATOR` (`KasbahCarAppService.kt`) : la liste
  des hôtes Android Auto de la bibliothèque est privée.
- **Construire et installer** :
  `JAVA_HOME` = le JDK d'Android Studio (`jbr`), `ANDROID_HOME` = le SDK, puis
  `./gradlew assembleDebug` dans `apps/android` et `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
  Le JDK livré avec Android Studio est un Java 25 : Gradle 9.1 au moins.
- **`.gitattributes`** : `*.cmd` en CRLF, `gradlew` en LF (voir [6_0](../6_faq/6_0_pieges-outillage.md)).

## Le téléphone : connexion

`MainActivity.kt` reprend la page de connexion du serveur (`PAGE_CSS` de `apps/server/src/mcp/auth.ts`) :
mêmes couleurs claires et sombres (`res/values{,-night}/colors.xml`), une carte, le logo, des
étiquettes en capitales, un bouton en pilule. Une fois connecté, la carte ne montre plus que
« Vous êtes connecté », le compte et l'hôte, et « Changer de compte ».

- **Session** : `POST /login` en formulaire, avec l'en-tête `Origin` de l'adresse saisie (le serveur
  refuse toute écriture sans elle, [1_13](1_13_comptes-et-sessions.md)). Le cookie
  `__Host-kasbah_session` est lu dans la réponse 303 et renvoyé à la main ; **le mot de passe n'est
  jamais gardé**. Sur le réseau local, `/login` renvoie à l'accueil sans cookie : pas de session, et
  ça marche quand même.
- **Preuve** : la connexion n'est dite réussie qu'après un `GET /api/devices` accepté.
- **Changer de compte** : `POST /logout` si le serveur répond, oubli local dans tous les cas.
- **Permission micro** demandée ici, téléphone en main, plutôt que sur la route.

## La voiture : portail et garages

`AccessScreen.kt` : une grille d'une tuile par appareil `cover` dont `meta.cover.deviceClass` vaut
`gate` ou `garage`, triée portail d'abord. Icône **dans le style trait du site** (24×24, trait 1,8,
bouts arrondis, cf. `apps/web/src/lib/strokeIcons.ts`) mais **propre à chaque nature**, ce que le site
n'a pas (il montre le volet pour tout ouvrant) : `ic_gate` (deux poteaux, barreaux) et `ic_garage`
(la maison et sa porte à panneaux), chacune en variante ouverte au-delà de 50 % comme `deviceIcons.ts`.
Choix de l'utilisateur : se lire d'un coup d'œil en conduisant. Puis l'état :
« Fermé », « Ouvert », « Ouverture… », « Hors ligne », ou « État inconnu » pour une radio à sens
unique (RTS) qui ne dit jamais sa position.

- **Un appui ne bouge rien** : la tuile ouvre `AccessActionScreen` (« Ouvrir », « Fermer », et
  « Stop » en haut). Choisir la tuile puis l'action tient lieu de confirmation.
- **Commandes** : `POST /api/devices/:id/command` avec `cover.open`, `cover.close`, `cover.stop`.
- **Rechargement** : à chaque retour sur l'écran, puis toutes les 3 s tant qu'une porte bouge. Pas
  de bouton « Actualiser » (voir le piège plus bas).
- **Icône de l'appli** : le logo du site (`apps/web/public/icons/icon-maskable.svg`) en icône
  adaptative, fond `#0d1420`. Les vecteurs `ic_launcher_foreground.xml` et `ic_kasbah_logo.xml` sont
  **générés** depuis les SVG (polygones → chemins, `rgba()` → `#AARRGGBB`) : modifier le SVG, pas le XML.
- **Deux noms, deux icônes** (demande de l'utilisateur : la PWA installée s'appelle aussi « Kasbah »,
  même logo). Sur le téléphone, l'appli s'appelle **« Kasbah Auto »** (`android:label` de
  l'application) et son icône porte une **pastille turquoise à voiture** dans le coin libre en haut à
  droite (`ic_launcher_badge.xml`, l'icône `vehicle` du site), le logo restant centré et à la taille
  de celui de la PWA (`ic_launcher_foreground_badged.xml`) ; la pastille tient sous un masque rond
  sans toucher la tour ni le cube. **Piège de taille** : une icône adaptative ne montre que les 72dp
  du milieu de son calque de 108dp, quand la PWA montre toute son image « maskable » : posé tel quel,
  le logo sortait 1,5 fois plus gros. Marge de 11dp (`ic_launcher_logo.xml`), mesurée à côté de la
  PWA sur le téléphone. Dans la voiture, il
  n'y a pas de PWA à distinguer : le service porte `android:label="Kasbah"` et l'icône sans pastille
  (`mipmap/ic_launcher_car`), et c'est bien ce qu'affiche Android Auto (simulateur, 2026-10-22).

## La voiture : « Voiture », le sondage

`ProbeScreen.kt` affiche ce qu'Android Auto transmet de la voiture (`CarHardwareManager` de
`app-projected`) : modèle, types d'énergie et de prise, batterie et autonomie, vitesse, compteur, et
l'écrit dans le journal du téléphone (`adb logcat -s KasbahProbe`). Valeurs brutes (codes, mètres)
et statut explicite (« non fourni », « indisponible ») : c'est un sondage, pas une vue. Les
permissions `com.google.android.gms.permission.CAR_FUEL`, `CAR_SPEED`, `CAR_MILEAGE` se demandent
sur le téléphone. **Pas de pression des pneus** : Android Auto n'en transmet pas. Ce que la R5
remonte vraiment reste à relever en voiture.

## La voiture : « Parler »

Le micro de l'accueil ouvre `VoiceScreen.kt`, qui écoute aussitôt :

1. **Écoute** (`recordSentence`, `Voice.kt`) : `CarAudioRecord`, le micro de la voiture, 16 kHz mono
   16 bits petit-boutiste (vérifié : la transcription comprend). Focus audio exclusif le temps
   d'écouter. Fin de phrase par **les règles du site** (`apps/web/src/lib/vad.ts`, recopiées) : 1 s de
   silence après la parole, « Rien entendu » sans parole dans les 5 premières secondes, 15 s au plus.
2. **Transcription** : WAV (en-tête de 44 octets) en base64 vers
   `POST /api/plugins/transcription/transcribe`, avec le vocabulaire de la maison comme le site
   (pièces, zones, niveaux, scènes, appareils ; `KasbahClient.vocabulary()`).
3. **Assistant** : `POST /api/assistant/ask`, flux NDJSON lu en entier ; les lignes `text` font la
   réponse, une ligne `error` devient le message affiché ([1_9](1_9_assistant.md)).
4. **Voix** : `POST /api/plugins/transcription/speak` (voix du compte, abréviations des niveaux dites
   en entier) joué par `MediaPlayer`, musique baissée. Si la route refuse (réponses parlées éteintes,
   synthèse arrêtée), **la voix d'Android** (`TextToSpeech`, français) prend le relais.

Mêmes titre et actions à chaque étape de l'écran (« Parler à Kasbah », « Reparler ») : l'hôte y voit
un rafraîchissement, pas un nouvel écran — Android Auto plafonne le nombre d'écrans d'une tâche.
Aucun mot d'éveil : seul l'assistant Google écoute en permanence. Ouvrir le portail par la voix
passe par l'assistant **sans confirmation**, comme sur le site.

## Le simulateur (DHU)

`apps/android/dhu.cmd` lance le *Desktop Head Unit* du SDK (`extras/google/auto`) : il relie le port
5277 du téléphone par `adb forward`, affiche ce qu'il faut faire sur le téléphone (Android Auto,
menu ⋮, « Démarrer le serveur de l'unité principale »), attend une touche, puis lance le simulateur
en écran large (`config/default_wide.ini`) ou, avec `dhu sensors`, en 800×480 avec capteurs simulés
(`config/default_sensors.ini` ; commandes `fuel`, `range`, `speed`, `odometer` dans sa console).
**Dans le simulateur, Ouvrir et Fermer commandent la vraie maison.** La console accepte aussi
`tap x y` et `screenshot <fichier>` : de quoi vérifier un écran sans toucher la fenêtre.

## Pièges

- **Une seule action à titre texte** dans une `ActionStrip` de grille : la deuxième fait planter
  l'appli à l'affichage (`Action list exceeded max number of 1 actions with custom titles`), et
  Android Auto ne montre que « Kasbah ne répond pas ». Les autres actions doivent être des icônes.
  Le journal du téléphone (`adb logcat -b crash`) donne la vraie cause.
- **Les couleurs : une couleur trop peu contrastée est remplacée, sans erreur.** L'appli teinte les
  icônes des tuiles selon l'état (turquoise ouvert, cuivre en mouvement, gris hors ligne) et remplit
  « Ouvrir » (`FLAG_PRIMARY`) de l'accent Kasbah, par `CarColor.createCustom`. Avec le turquoise du
  jour (`#1f6f78`), l'icône se lisait mal et le bouton restait dans le **bleu d'Android Auto**, quoi
  qu'on essaie (thème, couleur explicite, avec ou sans drapeau) : on a d'abord cru que les boutons ne
  prenaient jamais de couleur. Cause : Android Auto garde un **fond sombre même en mode jour**, et
  refuse une couleur sans assez de contraste. Les couleurs claires du thème sombre du site
  (`#4fb3bd`, `#e0aa70`, `#8d9ab0`), jour et nuit, sont respectées par les icônes **et** le bouton
  (simulateur, 2026-10-22). Le thème déclaré (`res/values/car_theme.xml`, clé `androidx.car.app.theme`)
  n'a pas eu d'effet visible. Fond, police et mise en page restent à la voiture, comme pour toute appli
  à modèles ; seules les applis de navigation ont une surface à dessiner.
- **Les titres et `setHeaderAction` des modèles sont dépréciés** au profit de `Header`, qui exige un
  hôte récent : gardés exprès, ils marchent partout.
- **Simulateur figé** (« waiting for phone », ou connexion puis `Failed to read from transport`) :
  voir [6_0](../6_faq/6_0_pieges-outillage.md), entrée du 2026-10-22.
- **Le lint Android** exige une vérification de `RECORD_AUDIO` dans la fonction même qui ouvre le
  micro, même si l'écran l'a déjà faite.

## Suites

- Essai dans la vraie voiture : liaison, micro de la voiture, ce que remonte le sondage.
- Les commandes vocales mains libres passeraient par **Google Home** (Kasbah en intégration
  « cloud-to-cloud », liaison de compte par l'OAuth du MCP) : non fait.
- Textes en français en dur dans le code (pas de `strings.xml`) : à reprendre si l'appli doit
  parler anglais.

### Mise à jour 2026-10-23 — invisible dans la vraie voiture : la Car App Library exige le Play Store

Premier essai dans la R5 : Kasbah n'apparaît ni dans la grille d'Android Auto, ni dans « Personnaliser
le lanceur » du téléphone, alors que « Sources inconnues » est coché. **C'est la règle de Google** : cette
option couvre les applis média, messagerie et « à l'arrêt », **pas les applis faites avec la Car App
Library** (guide « Test Android apps for cars », developer.android.com/training/cars/testing). Dans une
vraie voiture, une telle appli doit venir d'une source de confiance : Play Store, **Internal App
Sharing** ou piste de test interne. Le **simulateur DHU saute ce contrôle**, d'où tous les essais verts
de la veille au PC — la phrase « Installée à la main, mode développeur, Sources inconnues » plus haut ne
vaut donc que pour le simulateur.

Ce qui ne marche pas, essayé ce jour-là :
- `adb install -i com.android.vending` : Android Auto lit l'installeur **initiateur** (le shell), pas le
  nom déclaré (`installerPackageName`). Analyse détaillée de la validation (Android Auto 17.7) dans le
  ticket Fermata #846 sur GitHub ; elle dépend en partie de réglages côté serveur de Google.
- Retirer le nom et l'icône propres au service, ou la déclaration du thème : sans effet, remis.
- Un réglage de la voiture : le tri se fait dans l'appli Android Auto du téléphone, la voiture
  n'affiche que ce qu'elle reçoit. Seul un boîtier qui se fait passer pour un écran de développement
  (AAWireless, mode développeur) contournerait le contrôle, au gré d'un réglage serveur de Google.

Voie retenue : un compte développeur Google Play (droit d'entrée unique) et le **partage interne
d'applications**, sans relecture ni fiche publique. Le profil public du compte porte une adresse
e-mail **visible de tous** : en prendre une dédiée, jamais une adresse personnelle. La version installée
par `adb` doit être désinstallée avant, Play ne remplaçant pas une appli signée d'une autre clé.
Publier sur le Play Store public a été écarté pour l'instant : test fermé obligatoire, relecture des
applis voiture, serveur de démonstration à exposer, identité publique.

### Mise à jour 2026-10-23 — français et anglais

Les textes sont sortis du code : `res/values/strings.xml` (anglais, par défaut) et
`res/values-fr/strings.xml` (français), 53 chaînes, mêmes clés des deux côtés. Le téléphone choisit ;
l'écran de la voiture suit la langue du téléphone. La voix de secours (`TextToSpeech`) prend la langue
du téléphone au lieu du français imposé. Restent tels quels : « Kasbah », les noms des appareils (ceux
de la maison) et les messages d'erreur rendus par le serveur. Vérifié sur le téléphone dans les deux
langues (`adb shell cmd locale set-app-locales org.kasbah.auto --locales en-US`, puis retour au système).
La suite « Textes en français en dur » ci-dessus est donc faite.

### Mise à jour 2026-10-23 — mémo : de l'APK à la piste de test interne du Play Store

La marche à suivre courte est dans `docs/android-auto.md` (*For the car*). Ici, ce qu'on a appris en
la faisant, dans l'ordre :

1. **Compte développeur Google Play** (droit d'entrée unique, vérification d'identité). Le formulaire
   demande une **adresse pour le profil public**, visible de tous : une adresse dédiée, jamais
   personnelle. Le téléphone et l'adresse de contact, eux, restent privés.
2. **Créer l'application** : nom « Kasbah Auto », **nom de package `org.kasbah.auto`** (l'`applicationId`
   de `app/build.gradle.kts` ; définitif, Play refuse tout fichier dont l'identifiant diffère), langue
   par défaut anglais (celle de l'appli). La liste « Configurer votre application » du tableau de bord
   ne sert qu'à la publication : ignorée.
3. **Le partage interne d'applications est refusé** à une appli neuve : « doit être publiée pour que vous
   puissiez utiliser le partage interne ». Il accepte pourtant une version de debug, signée de n'importe
   quelle clé, numéro de version réutilisable (aide Google « Share app bundles and APKs internally ») :
   il servira pour les essais rapides une fois l'appli publiée sur une piste.
4. **Piste de test interne** à la place. Elle demande :
   - une **clé d'envoi** créée par `keytool` (Java d'Android Studio), rangée **hors du dépôt** ; le
     projet la lit dans `apps/android/keystore.properties` (ignoré par git, modèle
     `keystore.properties.example`), chemin écrit avec des `/`. Le `keytool` en français plante sur
     `-printcert` : `-J-Duser.language=en`. Le nom demandé par `keytool` (« CN ») n'est vu que de Google ;
   - un **App Bundle signé** : `./gradlew bundleRelease` (configuration `upload` de
     `app/build.gradle.kts`, absente quand le fichier de clé manque : la version de debug reste
     constructible partout) ;
   - **`targetSdk` 36** : exigé de toute appli nouvelle ou mise à jour depuis le 31 août 2026
     (developer.android.com/google/play/requirements/target-sdk). Passé de 35 à 36 (`compileSdk` aussi),
     vérifié sur le téléphone, qui redemande alors l'accès au micro ;
   - dans la console, *Tester et publier → Tests → Tests internes* : une **liste de testeurs** (le
     compte Google du téléphone), *Créer une version*, **clé de signature générée par Google** (l'option
     par défaut), import du `.aab`, *Enregistrer et publier*. Seul avertissement : pas de fichier de
     désobscurcissement (R8 n'est pas activé, l'appli est petite) — ignoré.
5. **Sur le téléphone** : le **lien d'activation** des testeurs se copie dans l'onglet *Testeurs* de la
   piste (console web, et sans doute aussi l'appli Play Console) ; l'ouvrir dans Chrome avec le compte
   du téléphone, accepter, **désinstaller la version posée par `adb`** (signée d'une autre clé, Play ne la remplace
   pas), installer depuis le Play Store. La première version met quelques minutes à y apparaître.
6. **Mises à jour** : augmenter `versionCode`, reconstruire le bundle, nouvelle version de test interne.

**Vérifié dans la vraie voiture le 2026-10-23** : installée depuis la piste de test interne, l'appli apparaît dans la grille d'Android Auto (« Kasbah », logo sans pastille), l'écran des accès affiche les vrais états, et « Parler » transcrit la question posée au micro de la voiture. L'écran de la voiture n'affiche que le **début** d'un message : la réponse, placée après la question et une ligne vide, tombait dans la partie coupée (elle était bien dite). Depuis la version 0.2 (`versionCode` 2), l'écran montre la question pendant la réflexion, puis **la réponse seule** ; une réponse très longue reste coupée en fin de texte, mais elle est lue.

### Mise à jour 2026-10-23 — des tests, sans téléphone ni voiture

`./gradlew testDebugUnitTest` dans `apps/android`, une minute environ, hors de `npm test` (Java et le SDK
Android ne sont pas sur toutes les machines) ; branché dans `/publish` pour tout diff de `apps/android/`.
`app/src/test/kotlin/org/kasbah/auto/` :

- `EndpointerTest` : les cas de `apps/web/src/lib/vad.test.ts`, la copie Kotlin devant rester fidèle. Il
  a trouvé un écart : la copie rendait encore des événements après le premier ; corrigé (`done`).
- `VoiceAudioTest` : niveau RMS d'une trame 16 bits petit-boutiste, en-tête WAV champ par champ.
- `ParsingTest` : cookie de session (casse de l'en-tête, réseau local sans cookie), tri portail et
  garages de `/api/devices`, réponse de l'assistant ligne à ligne (`error` avec ou sans message), noms
  des prises. Ces lectures sont sorties du client en fonctions pures (`sessionCookie`, `parseAccesses`,
  `parseAnswer` dans `KasbahClient.kt`, `plugName` dans `ProbeScreen.kt`) ; `org.json:json` en test,
  celui d'Android n'étant qu'une coquille sur la JVM.
- `CarScreensTest` : les écrans construits par `TestCarContext` (`androidx.car.app:app-testing`) sur
  Robolectric — une tuile par accès et son état, barre à une seule action titrée, attente puis liste
  vide, erreur avec « Actualiser », écran d'action en anglais et en français, « Parler » qui montre la
  réponse seule. La bibliothèque vérifie chaque modèle contre les règles de l'hôte en le construisant :
  **contre-épreuve faite**, une seconde action titrée remise dans la barre fait échouer trois tests sur
  l'erreur exacte vue dans la voiture le 2026-10-22.

Pièges rencontrés :
- **Java 25** (celui d'Android Studio) ferme `jdk.internal.access`, dont Robolectric a besoin :
  `--add-opens=java.base/jdk.internal.access=ALL-UNNAMED` pour la JVM des tests (`testOptions` de
  `app/build.gradle.kts`).
- **Une propriété de haut de fichier qui appelle Android** (`AudioAttributes` de `Voice.kt`) s'exécute
  au chargement de la classe du fichier, donc dès qu'un test appelle une fonction pure du même fichier :
  « Stub! ». Construite au premier usage (`by lazy`).
- Les états des tests d'écran passent par deux champs `@VisibleForTesting` (`AccessScreen.accesses`,
  `error`) et `VoiceScreen.answered` : pas de serveur ni de micro à simuler.
- Non couvert : l'écran « Voiture » (il lit le matériel de la voiture) ; sa mise en forme l'est en partie
  (`plugName`).
