// Couches de rendu (three `Object3D.layers`). Deux, pour que l'OCCLUSION ambiante voie la scène
// autrement que le rendu : `ArchitectureGTAOPass` (`core/post.ts`) les éteint le temps de son relevé
// en profondeur et en normales. Un halo est un sprite additif, sans volume ; vu par ce relevé, il
// devenait un panneau plein face à la caméra, donc un obstacle, donc un carré NOIR sous chaque lampe
// allumée. Tout ce qui est translucide ou additif, posé sur la scène sans en être la matière, y vit.
//
// `DECOR_LAYER` — les décors des appareils d'un NIVEAU (halo d'une lampe, onde d'un lecteur, jauges
// d'un coffret ou d'un module, pochette sur un écran, guide du mode « déplacer ») et ceux du mode
// ÉDITION (poignées d'ouverture, lignes de cote, repère d'origine, marquage des places). Le lancer
// de rayon ouvre cette couche : c'est ce qui rend une poignée touchable.
//
// `SITE_DECOR_LAYER` — les mêmes décors, mais ceux du JARDIN, que le lancer de rayon ne voit pas.
//
// Jusqu'au 2026-09-24 la scène se rendait en PASSES (une globale, puis une par niveau allumé) et
// une troisième couche, `LAMP_LAYER`, tenait les lampes d'intérieur hors de la passe globale. Une
// seule passe aujourd'hui : la lampe est cantonnée à son niveau par le shader (`core/levelLight.ts`).
export const DECOR_LAYER = 1
export const SITE_DECOR_LAYER = 3
