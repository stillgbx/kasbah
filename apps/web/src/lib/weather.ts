import type { WeatherCondition } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

// Ce que l'UI fait d'une condition météo : une icône, la même partout (widget, vue, carte). Le jour
// et la nuit ne changent que les conditions où le ciel se voit — un nuage de pluie est le même à
// minuit.

const CONDITION_ICONS: Record<WeatherCondition, IconName> = {
  clear: 'sun', partly_cloudy: 'cloudSun', cloudy: 'cloud', fog: 'fog', drizzle: 'drizzle', rain: 'rain',
  snow: 'snow', sleet: 'snow', thunderstorm: 'thunder',
}

export function conditionIcon(condition: WeatherCondition, isDay = true): IconName {
  if (!isDay && condition === 'clear') return 'moon'
  if (!isDay && condition === 'partly_cloudy') return 'cloudMoon'
  return CONDITION_ICONS[condition]
}

/** Point cardinal (8 secteurs) d'une direction en degrés depuis le nord, pour l'annoncer en lettres. */
export function compassPoint(deg: number): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!
}
