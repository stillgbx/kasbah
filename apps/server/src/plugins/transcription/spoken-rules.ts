// What speech synthesis mispronounces, language by language (`STT_LANGUAGE`). Adding a replacement =
// one line in the language's table; a missing language goes through as is. The order of the lines is
// free: the longest spellings are tried first (`kWh` before `kW` before `W`).

export interface SpokenRules {
  /** Word or abbreviation, as is anywhere in the sentence (case ignored) → what is said. */
  words: Record<string, string>
  /** Unit symbol after a number ("21 °C", "21°C") → [singular, plural]. Case respected. */
  units: Record<string, [string, string]>
  /** Does the number take the plural? */
  plural: (n: number) => boolean
  /** The sign of a negative number ("-3 °C"). */
  minus: string
  /** "8h30", "14:05" → [hour, hours]; absent: left to the engine. */
  hours?: [string, string]
}

export const SPOKEN_RULES: Record<string, SpokenRules> = {
  fr: {
    words: {
      RDC: 'rez-de-chaussée',
      'n°': 'numéro',
      'env.': 'environ',
      '1er': 'premier',
      '1re': 'première',
      '1ère': 'première',
      '2e': 'deuxième',
      '2ème': 'deuxième',
      '3e': 'troisième',
      '3ème': 'troisième',
      '4e': 'quatrième',
      '4ème': 'quatrième',
    },
    units: {
      '°C': ['degré', 'degrés'],
      '°': ['degré', 'degrés'],
      '%': ['pour cent', 'pour cent'],
      kWh: ['kilowattheure', 'kilowattheures'],
      Wh: ['wattheure', 'wattheures'],
      kW: ['kilowatt', 'kilowatts'],
      W: ['watt', 'watts'],
      'km/h': ['kilomètre heure', 'kilomètres heure'],
      km: ['kilomètre', 'kilomètres'],
      'm²': ['mètre carré', 'mètres carrés'],
      'm³': ['mètre cube', 'mètres cubes'],
      cm: ['centimètre', 'centimètres'],
      mm: ['millimètre', 'millimètres'],
      m: ['mètre', 'mètres'],
      min: ['minute', 'minutes'],
      hPa: ['hectopascal', 'hectopascals'],
      A: ['ampère', 'ampères'],
      V: ['volt', 'volts'],
      '€': ['euro', 'euros'],
    },
    // "1,5 degré": singular below 2
    plural: (n) => Math.abs(n) >= 2,
    minus: 'moins',
    hours: ['heure', 'heures'],
  },
  en: {
    words: {
      approx: 'approximately',
      'no.': 'number',
    },
    units: {
      '°C': ['degree Celsius', 'degrees Celsius'],
      '°F': ['degree Fahrenheit', 'degrees Fahrenheit'],
      '°': ['degree', 'degrees'],
      '%': ['percent', 'percent'],
      kWh: ['kilowatt hour', 'kilowatt hours'],
      Wh: ['watt hour', 'watt hours'],
      kW: ['kilowatt', 'kilowatts'],
      W: ['watt', 'watts'],
      'km/h': ['kilometer per hour', 'kilometers per hour'],
      mph: ['mile per hour', 'miles per hour'],
      km: ['kilometer', 'kilometers'],
      mm: ['millimeter', 'millimeters'],
      min: ['minute', 'minutes'],
      A: ['amp', 'amps'],
      V: ['volt', 'volts'],
    },
    // "1.5 degrees": singular for 1 only
    plural: (n) => Math.abs(n) !== 1,
    minus: 'minus',
  },
}
