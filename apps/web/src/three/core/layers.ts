// Couches de rendu (three `Object3D.layers`). Deux, et chacune existe pour permettre à une passe de
// voir la scène AUTREMENT que la passe suivante — three teste la couche d'un objet contre celle de la
// caméra, y compris pour les lumières et pour le relevé des ombres.
//
// `DECOR_LAYER` — ce qui est POSÉ sur la scène sans en être la matière : le halo d'une lampe, l'onde
// d'un lecteur, les jauges d'un coffret ou d'un module, le guide du mode « déplacer ». Deux passes
// l'éteignent :
//   - l'OCCLUSION ambiante, qui redessine la scène en profondeur et en normales. Un halo est un
//     sprite additif, sans volume ; vue par cette passe, l'image devenait un panneau plein face à la
//     caméra, donc un obstacle, donc un carré NOIR sous chaque lampe allumée ;
//   - la passe GLOBALE du rendu en passes, qui dessine toute la matière d'un coup. Un décor
//     translucide dessiné là PUIS dans la passe de son groupe se mélangerait deux fois.
//
// `LAMP_LAYER` — les lumières ponctuelles des appareils. La passe globale l'éteint : c'est ce qui
// fait qu'une lampe n'éclaire que les surfaces de son propre groupe (son niveau, ou le jardin), une
// `PointLight` ignorant la géométrie qui devrait l'arrêter. Les maillages des appareils, eux, restent
// sur la couche commune : ils doivent être VUS par la passe globale, sinon ils ne portent pas
// d'ombre — un volet fermé laissait passer le soleil dans la pièce.
export const DECOR_LAYER = 1
export const LAMP_LAYER = 2
