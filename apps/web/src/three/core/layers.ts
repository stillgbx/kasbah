// Couches de rendu (three `Object3D.layers`). Une seule, pour l'instant, et elle a une raison précise.
//
// Le halo d'une lampe (`LightMarker`) est un SPRITE additif : une image qui ajoute de la lumière, et
// qui n'occupe aucun volume. L'occlusion ambiante (`core/post.ts`), elle, redessine la scène en
// profondeur et en normales pour savoir ce qui bouche quoi — et un sprite, vu par cette passe, est
// un panneau plein face à la caméra. Résultat observé : un carré NOIR sous chaque lampe allumée,
// l'occlusion prenant le halo pour un obstacle.
//
// Le halo vit donc sur sa propre couche, que la caméra voit pour le rendu final et que la passe
// d'occlusion éteint le temps de son relevé. Le lancer de rayon n'est pas concerné : un halo n'a
// jamais été cliquable (seule la sphère de la lampe l'est).
export const DECOR_LAYER = 1
