import { z } from 'zod'

// Responses of Open-Meteo's two APIs, as LENIENT schemas: `z.looseObject` for the keys we don't
// read, `z.unknown()` on what doesn't matter type-wise (the TaHoma lesson: constraining a useless
// field is enough to make the whole response fail). The hourly and daily series are parallel
// columns (`time[i]` goes with `temperature_2m[i]`): one array per variable, never an array of
// objects. A value may be `null` when the model doesn't provide it (precipitation probability
// with a single model): we read it as absent.

/** Numeric column of a series: the model's gaps are `null`s. */
const column = z.array(z.number().nullable())

export const currentSchema = z.looseObject({
  /** Start of the current step, in epoch SECONDS (`timeformat=unixtime`). */
  time: z.number(),
  temperature_2m: z.number().nullable().optional(),
  relative_humidity_2m: z.number().nullable().optional(),
  apparent_temperature: z.number().nullable().optional(),
  is_day: z.number().nullable().optional(),
  precipitation: z.number().nullable().optional(),
  weather_code: z.number().nullable().optional(),
  cloud_cover: z.number().nullable().optional(),
  pressure_msl: z.number().nullable().optional(),
  wind_speed_10m: z.number().nullable().optional(),
  wind_direction_10m: z.number().nullable().optional(),
  wind_gusts_10m: z.number().nullable().optional(),
})

export const forecastResponseSchema = z.looseObject({
  utc_offset_seconds: z.number(),
  /** IANA time zone of the place (`timezone=auto`): the UI shows a distant place's times in it. */
  timezone: z.string().optional(),
  current: currentSchema,
  hourly: z.looseObject({
    time: z.array(z.number()),
    temperature_2m: column.optional(),
    precipitation_probability: column.optional(),
    precipitation: column.optional(),
    weather_code: column.optional(),
    wind_speed_10m: column.optional(),
    is_day: column.optional(),
    visibility: column.optional(),
    uv_index: column.optional(),
    dew_point_2m: column.optional(),
  }),
  daily: z.looseObject({
    /** LOCAL midnight of each day, in epoch seconds. */
    time: z.array(z.number()),
    weather_code: column.optional(),
    temperature_2m_max: column.optional(),
    temperature_2m_min: column.optional(),
    sunrise: column.optional(),
    sunset: column.optional(),
    uv_index_max: column.optional(),
    precipitation_sum: column.optional(),
    precipitation_probability_max: column.optional(),
  }),
})
export type ForecastResponse = z.infer<typeof forecastResponseSchema>

export const airQualityResponseSchema = z.looseObject({
  current: z.looseObject({
    time: z.number(),
    european_aqi: z.number().nullable().optional(),
    alder_pollen: z.number().nullable().optional(),
    birch_pollen: z.number().nullable().optional(),
    grass_pollen: z.number().nullable().optional(),
    mugwort_pollen: z.number().nullable().optional(),
    olive_pollen: z.number().nullable().optional(),
    ragweed_pollen: z.number().nullable().optional(),
  }),
})
export type AirQualityResponse = z.infer<typeof airQualityResponseSchema>

/** A place found by the geocoding API (`geocoding-api.open-meteo.com`, GeoNames). */
export const geocodingPlaceSchema = z.looseObject({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
})
/** With no result, the `results` key is ABSENT (not an empty array). */
export const geocodingResponseSchema = z.looseObject({ results: z.array(geocodingPlaceSchema).optional() })
export type GeocodingResponse = z.infer<typeof geocodingResponseSchema>
