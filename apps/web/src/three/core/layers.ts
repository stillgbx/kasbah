// Couches de rendu (three `Object3D.layers`). Trois, et chacune existe pour permettre à une passe de
// voir la scène AUTREMENT que la suivante — three teste la couche d'un objet contre celle de la
// caméra, y compris pour les lumières (`projectObject`) et pour le relevé des ombres
// (`WebGLShadowMap.renderObject`). C'est ce qui remplace le masquage par `visible` : masquer un objet
// pour l'exclure d'un éclairage l'exclut AUSSI de l'ombre — un volet fermé laissait passer le soleil.
//
// `DECOR_LAYER` — ce qui est POSÉ sur la scène sans en être la matière, pour les appareils d'un
// NIVEAU : halo d'une lampe, onde d'un lecteur, jauges d'un coffret ou d'un module, pochette sur un
// écran, guide du mode « déplacer ». Deux passes l'éteignent :
//   - l'OCCLUSION ambiante, qui redessine la scène en profondeur et en normales. Un halo est un
//     sprite additif, sans volume ; vue par cette passe, l'image devenait un panneau plein face à la
//     caméra, donc un obstacle, donc un carré NOIR sous chaque lampe allumée ;
//   - la passe GLOBALE, qui dessine toute la matière d'un coup. Un décor translucide dessiné là PUIS
//     dans la passe de son niveau se mélangerait deux fois.
//
// `SITE_DECOR_LAYER` — les mêmes décors, mais ceux du JARDIN. Ils ne sont pas dessinés au même
// moment : le décor d'un niveau l'est dans la passe de son niveau, celui du jardin dans la passe
// globale — la seule où le terrain est dessiné. Deux couches pour une même idée, parce que c'est le
// MOMENT du dessin qui diffère, pas la nature de l'objet.
//
// `LAMP_LAYER` — les lumières ponctuelles des lampes d'un NIVEAU, et elles seules. La passe globale
// l'éteint : c'est ce qui fait qu'une lampe d'intérieur n'éclaire que les surfaces de son niveau,
// une `PointLight` ignorant la géométrie qui devrait l'arrêter. Une lampe de JARDIN, elle, reste sur
// la couche commune et porte une vraie ombre : elle doit éclairer la façade sans traverser le mur, et
// la seule chose qui arrête vraiment la lumière est une ombre portée.
export const DECOR_LAYER = 1
export const LAMP_LAYER = 2
export const SITE_DECOR_LAYER = 3
