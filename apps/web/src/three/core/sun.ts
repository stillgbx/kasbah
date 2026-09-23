// Le calcul du soleil vit dans `@kasbah/shared` depuis que le serveur en a besoin (automatisations
// au lever, au coucher, au crépuscule). Ré-exporté ici pour les appelants de la scène.
export { approximateSunPosition, sunPosition, type SunPosition } from '@kasbah/shared'
