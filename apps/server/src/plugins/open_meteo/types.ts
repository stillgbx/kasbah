import { z } from 'zod'

// Réponses des deux API d'Open-Meteo, en schémas LARGES : `z.looseObject` pour les clés qu'on ne
// lit pas, `z.unknown()` sur ce dont le type ne compte pas (la leçon TaHoma : contraindre un champ
// inutile suffit à faire échouer toute la réponse). Les séries horaires et quotidiennes sont des
// colonnes parallèles (`time[i]` va avec `temperature_2m[i]`) : un tableau par variable, jamais un
// tableau d'objets. Une valeur peut être `null` quand le modèle ne la fournit pas (la probabilité de
// précipitation avec un modèle seul) : on la lit comme absente.

/** Colonne numérique d'une série : les trous du modèle sont des `null`. */
const column = z.array(z.number().nullable())

export const currentSchema = z.looseObject({
  /** Début du pas courant, en SECONDES epoch (`timeformat=unixtime`). */
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
    /** Minuit LOCAL de chaque jour, en secondes epoch. */
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
