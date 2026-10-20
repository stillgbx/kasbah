import type { WeatherCondition } from '@kasbah/shared'
import type { IconName } from './strokeIcons'

// What the UI does with a weather condition: an icon, the same everywhere (widget, view, map). Day
// and night only change the conditions where the sky is visible — a rain cloud is the same at
// midnight.

const CONDITION_ICONS: Record<WeatherCondition, IconName> = {
  clear: 'sun', partly_cloudy: 'cloudSun', cloudy: 'cloud', fog: 'fog', drizzle: 'drizzle', rain: 'rain',
  snow: 'snow', sleet: 'snow', thunderstorm: 'thunder',
}

export function conditionIcon(condition: WeatherCondition, isDay = true): IconName {
  if (!isDay && condition === 'clear') return 'moon'
  if (!isDay && condition === 'partly_cloudy') return 'cloudMoon'
  return CONDITION_ICONS[condition]
}

/** Cardinal point (8 sectors) of a direction in degrees from north, to announce it in letters. */
export function compassPoint(deg: number): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!
}
