---
name: garden-species
description: >-
  Crée une ESPÈCE du jardin de la vue 3D (cerisier, olivier, bouleau…) à partir d'une photo : lit
  le port, les proportions et les couleurs de l'arbre, écrit sa recette facettée
  `apps/web/src/three/garden/species/<id>.json` avec ses quatre saisons, puis la vérifie dans la
  preview jusqu'à validation par l'utilisateur. À utiliser quand l'utilisateur dit « crée l'espèce
  X », « fais-moi un asset de cet arbre », « ajoute un cerisier au jardin » ou envoie une photo de
  plante pour la 3D. Pas de fichier 3D, pas de modèle téléchargé : une recette lue par le
  générateur procédural (`speciesShape.ts`).
---

# Espèce du jardin depuis une photo

Le jardin est dessiné en LOW-POLY FACETTÉ (référence donnée par l'utilisateur : les packs nature de
Pure Poly). Une espèce n'est pas un maillage : c'est une recette de proportions, de port et de
couleurs que le générateur transforme en facettes. On ne vise pas la photo, on vise la silhouette
reconnaissable dans ce style.

## 1. Entrées

- **La photo.** Si elle est sur disque (chemin donné, fichier déposé), les couleurs se MESURENT
  (étape 3). Si elle n'existe que dans la conversation, les estimer à l'œil et le dire dans le compte
  rendu (« couleurs estimées, pas mesurées »).
- **L'espèce.** Nom commun fr + en, famille (`broadleaf`, `conifer`, `palm`, `shrub`), id en
  kebab-case anglais (`cherry`, `olive`, `silver-birch`). Si la photo ne permet pas de l'identifier,
  demander.
- Lire la recette existante la plus proche dans `apps/web/src/three/garden/species/` : même format,
  même granularité.

## 2. Lire la silhouette

Mesurer sur la photo, en proportion de la hauteur totale de l'arbre (pied → cime) :

| Champ | Ce qu'on regarde |
|---|---|
| `trunk.height` | hauteur du fût NU, jusqu'aux premières grosses branches (0,15 à 0,5) |
| `trunk.radius` | rayon au pied / hauteur (0,02 arbre élancé … 0,06 vieux tronc) |
| `trunk.lean` | inclinaison visible, en radians (0 à 0,2 d'ordinaire) |
| `trunk.forks` | charpentières visibles au départ du houppier (0 à 4) |
| `crown.shape` | `round` boule · `spreading` étalé, plus large que haut · `oval` ovoïde dressé · `cone` conique · `column` colonnaire |
| `crown.width` | largeur du houppier / hauteur totale |
| `crown.masses` | masses de feuillage distinctes (5 compact … 12 très découpé) |
| `crown.roughness` | irrégularité des masses (0,1 lisse … 0,3 ébouriffé) |
| `crown.droop` | retombée des bords (0 dressé … 0,4 branches qui pendent … 1 pleureur) |
| `height` | hauteur adulte courante en jardin, en m (valeur proposée à la plantation) |

## 3. Mesurer les couleurs

```bash
node scripts/photo-palette.mjs <photo> --crop x,y,w,h --k 3
```

`--crop` en fractions de l'image (0..1). Trois zones :

- **feuillage** : le cœur du houppier → `leaf.color` = la teinte dominante MOYENNE ;
- **haut du houppier**, côté lumière → `leaf.top` = la plus claire des dominantes ;
- **tronc** → `trunk.color` ; **fruits / fleurs** s'il y en a → `accent.color` (petite zone
  serrée sur eux, `--k 2`).

Le style facetté aime les couleurs FRANCHES : désaturer le moins possible, mais écarter les
dominantes « ombre » presque noires (elles viennent du sous-bois, pas de la plante).

## 4. Les quatre saisons

La recette de base est l'ÉTÉ. `seasons` décrit ce qui change, d'après la botanique de l'espèce, pas
d'après la photo (qui ne montre qu'une saison) :

- `foliage` : part du feuillage restant (caduc en hiver = 0, marcescent ≈ 0,3, persistant = absent) ;
- `leaf` : couleurs du feuillage (tendre au printemps, automne propre à l'espèce) ;
- `accent` : fleurs au printemps, fruits l'été ou l'automne, `null` quand il n'y en a pas.

Si la photo montre une autre saison que l'été, ses couleurs vont dans CETTE saison, et l'été se
déduit.

## 5. Écrire la recette

`apps/web/src/three/garden/species/<id>.json`, validé par `speciesSchema` (`species.ts`). Renseigner
`source` (photo, date, ce qui a été estimé). Puis :

```bash
npx vitest run apps/web/src/three/garden
```

Le test valide TOUTES les recettes et construit chaque saison : une recette invalide est sinon
écartée en silence par le catalogue (simple avertissement console).

## 6. Vérifier dans la preview

Preview `kasbah-mock` (données simulées, rien n'est écrit dans la vraie maison). Dans la page, par
`javascript_tool` :

```js
const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
const h = pinia._s.get('house'), st = pinia._s.get('settings')
st.setSceneAmbience('day')                     // juger de jour ; remettre 'auto' après
h.startPlacingGarden('broadleaf', 'cherry'); await h.placeGardenAt([0, 18]); h.cancelPlacingGarden()
h.selectGardenItem(h.house.site.garden.at(-1).id)   // cadre l'arbre ; puis selectGardenItem(null)
st.setSceneSeason('spring')                    // une capture par saison, puis 'auto'
```

Une capture par saison, côte à côte avec la photo dans le compte rendu. Itérer sur la recette avec
l'utilisateur (« plus étalé », « tronc plus court ») jusqu'à ce qu'il valide. Remettre ambiance et
saison sur `auto` en partant.

## 7. Ne pas faire

- Ni modèle 3D téléchargé ni texture : le style est procédural (décision du 2026-09-28).
- Ne pas toucher au générateur pour UNE espèce. Si une silhouette est inatteignable avec les champs
  existants (palmier en éventail, arbre fastigié tordu), le dire et proposer d'étendre la recette.
- Pas de commit sans demande.
