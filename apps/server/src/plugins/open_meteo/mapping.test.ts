import { describe, expect, it } from 'vitest'
import { defaultState, deviceDescriptorSchema, mergeState, weatherForecastSchema } from '@kasbah/shared'
import { AIR_QUALITY, FORECAST } from './__fixtures__/open-meteo'
import { dayIndex, hourIndex, pollenLevel, toDescriptor, toForecast, toStatePatch, wmoToCondition } from './mapping'
import { airQualityResponseSchema, forecastResponseSchema } from './types'

// Mapping tested on CAPTURED responses (see `__fixtures__/open-meteo.ts`): September 16, 2026,
// 09:45 in Dijon, overcast sky (code 3), 16.8 °C, "good" air (EAQI 17), a little mugwort.

const forecast = forecastResponseSchema.parse(FORECAST)
const air = airQualityResponseSchema.parse(AIR_QUALITY)

describe('reading real responses', () => {
  it('the schemas accept what the service sends, 192-hour and 8-day series included', () => {
    expect(forecast.hourly.time).toHaveLength(192)
    expect(forecast.daily.time).toHaveLength(8)
    expect(forecast.current.weather_code).toBe(3)
    expect(air.current.european_aqi).toBe(17)
  })

  it('tolerates a column of `null` (probability missing with a single model)', () => {
    const nulls = { ...FORECAST, hourly: { ...FORECAST.hourly, precipitation_probability: FORECAST.hourly.time.map(() => null) } }
    expect(forecastResponseSchema.safeParse(nulls).success).toBe(true)
  })
})

describe('wmoToCondition', () => {
  it('covers the WMO codes emitted by Open-Meteo', () => {
    expect([0, 1, 2, 3, 45, 48].map(wmoToCondition)).toEqual(['clear', 'clear', 'partly_cloudy', 'cloudy', 'fog', 'fog'])
    expect([51, 55, 56, 61, 65, 66, 71, 77, 80, 82, 85, 95, 99].map(wmoToCondition))
      .toEqual(['drizzle', 'drizzle', 'sleet', 'rain', 'rain', 'sleet', 'snow', 'snow', 'rain', 'rain', 'snow', 'thunderstorm', 'thunderstorm'])
    expect(wmoToCondition(null)).toBe('cloudy')
  })
})

describe('toStatePatch', () => {
  const patch = toStatePatch(forecast, air)

  it('reads current conditions from `current`, completed by the current hourly step and day', () => {
    expect(patch).toMatchObject({
      condition: 'cloudy', tempC: 16.8, feelsLikeC: 15.9, humidity: 71, pressureHpa: 1019.2, windKmh: 8.9, windGustKmh: 21.6,
      windDirDeg: 333, cloudCover: 100, precipMm: 0, isDay: true, observedAt: 1789544700 * 1000,
    })
    // 09:45 local: hourly step 09:00 (index 9 of the day), day 0
    const h = hourIndex(forecast.hourly.time, forecast.current.time)
    expect(forecast.hourly.time[h]).toBe(Math.floor(forecast.current.time / 3600) * 3600)
    expect(patch.visibilityM).toBe(forecast.hourly.visibility![h])
    expect(patch.uvIndex).toBe(forecast.hourly.uv_index![h])
    expect(patch.dewPointC).toBe(forecast.hourly.dew_point_2m![h])
    expect(patch.precipProbability).toBe(forecast.hourly.precipitation_probability![h])
    expect(dayIndex(forecast.daily.time, forecast.current.time)).toBe(0)
    expect(patch.sunrise).toBe(1789535907 * 1000)
    expect(patch.sunset).toBe(1789580999 * 1000)
  })

  it('grades the air and the pollens', () => {
    expect(patch.aqi).toBe(17)
    expect(patch.aqiLevel).toBe('good')
    // 1.2 grains of mugwort and 0.5 of ragweed: "low"; zeros stay zeros, never absent
    expect(patch.pollen).toEqual({ alder: 0, birch: 0, grass: 0, mugwort: 1, olive: 0, ragweed: 1 })
    expect([0, 5, 20, 100, 500].map(pollenLevel)).toEqual([0, 1, 2, 3, 4])
  })

  it('clears the air when its API is missing, and the merged state stays valid', () => {
    const without = toStatePatch(forecast, null)
    expect(without.aqi).toBeNull()
    expect(without.aqiLevel).toBeNull()
    expect(without.pollen).toBeNull()
    const merged = mergeState(defaultState('weather', 1), { available: true, ...without }, 2)
    expect(merged).not.toHaveProperty('aqi')
    expect(merged.available).toBe(true)
  })
})

describe('toForecast', () => {
  it('gives 24 hours from the current hour and 7 days from today, in the shared schema', () => {
    const f = toForecast(forecast, forecast.current.time)
    expect(f.hourly).toHaveLength(24)
    expect(f.hourly[0]!.t).toBe(Math.floor(forecast.current.time / 3600) * 3600 * 1000)
    expect(f.daily).toHaveLength(7)
    expect(f.daily[0]!.t).toBe(forecast.daily.time[0]! * 1000)
    expect(f.daily[0]).toMatchObject({ condition: 'cloudy', minC: 16.6, maxC: 22.5, precipProbability: 48, uvIndexMax: 4.7 })
    expect(weatherForecastSchema.parse({ deviceId: 'open_meteo:home', ...f })).toBeTruthy()
  })

  it('limits itself to what is left when the requested hour is at the end of the series', () => {
    const lastHour = forecast.hourly.time.at(-3)!
    const f = toForecast(forecast, lastHour)
    expect(f.hourly).toHaveLength(3)
    expect(f.daily).toHaveLength(1)
  })
})

describe('toDescriptor', () => {
  it('declares the air capabilities only when the API answers, and carries the attribution', () => {
    expect(deviceDescriptorSchema.parse(toDescriptor(true)).capabilities).toEqual(['forecast', 'air_quality', 'pollen'])
    expect(toDescriptor(false).capabilities).toEqual(['forecast'])
    expect(toDescriptor(false).meta.weather?.attribution).toMatch(/Open-Meteo/)
  })
})
