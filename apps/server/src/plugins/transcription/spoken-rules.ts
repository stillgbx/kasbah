// Ce que la synthèse vocale prononce mal, langue par langue (`STT_LANGUAGE`). Ajouter un remplacement =
// une ligne dans la table de la langue ; une langue absente passe telle quelle. L'ordre des lignes est
// libre : les écritures les plus longues sont essayées d'abord (`kWh` avant `kW` avant `W`).

export interface SpokenRules {
  /** Mot ou abréviation, tel quel n'importe où dans la phrase (casse ignorée) → ce qui est dit. */
  words: Record<string, string>
  /** Symbole d'unité après un nombre (« 21 °C », « 21°C ») → [singulier, pluriel]. Casse respectée. */
  units: Record<string, [string, string]>
  /** Le nombre prend-il le pluriel ? */
  plural: (n: number) => boolean
  /** Le signe d'un nombre négatif (« -3 °C »). */
  minus: string
  /** « 8h30 », « 14:05 » → [heure, heures] ; absent : laissé au moteur. */
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
    // « 1,5 degré » : singulier sous 2
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
    // « 1.5 degrees » : singulier pour 1 seulement
    plural: (n) => Math.abs(n) !== 1,
    minus: 'minus',
  },
}
