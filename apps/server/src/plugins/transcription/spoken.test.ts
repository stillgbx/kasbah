import { describe, expect, it } from 'vitest'
import { spokenText } from './spoken'
import { SPOKEN_RULES } from './spoken-rules'

const fr = (text: string) => spokenText(text, 'fr')
const en = (text: string) => spokenText(text, 'en')

describe('texte réécrit pour la voix, en français', () => {
  it('les heures : « 8h00 », « 8 h 30 », « 14h », « 14:05 », « 1h »', () => {
    expect(fr('Réveil à 8h00.')).toBe('Réveil à 8 heures.')
    expect(fr('Départ à 8 h 30, retour à 14h.')).toBe('Départ à 8 heures 30, retour à 14 heures.')
    expect(fr('Prévu à 14:05')).toBe('Prévu à 14 heures 5')
    expect(fr('Encore 1h15 de charge.')).toBe('Encore 1 heure 15 de charge.')
    expect(fr('Rien à 08h05')).toBe('Rien à 8 heures 5')
  })

  it('les unités, au singulier sous 2 et au pluriel au-delà', () => {
    expect(fr('Il fait 21,5 °C dehors et 1,5°C de plus.')).toBe('Il fait 21,5 degrés dehors et 1,5 degré de plus.')
    expect(fr('Il fait -3 °C.')).toBe('Il fait moins 3 degrés.')
    expect(fr('Batterie à 80 %, 3,2 kW produits, 12 kWh aujourd\'hui.')).toBe('Batterie à 80 pour cent, 3,2 kilowatts produits, 12 kilowattheures aujourd\'hui.')
    expect(fr('Charge à 8 A, 230 V, 450 W.')).toBe('Charge à 8 ampères, 230 volts, 450 watts.')
    expect(fr('Vent à 30 km/h, 2 mm de pluie, encore 1 min.')).toBe('Vent à 30 kilomètres heure, 2 millimètres de pluie, encore 1 minute.')
  })

  it('les abréviations et les ordinaux', () => {
    expect(fr('Le RDC et le 1er étage sont éteints, la 2e chambre aussi.')).toBe('Le rez-de-chaussée et le premier étage sont éteints, la deuxième chambre aussi.')
    expect(fr('La 1re lampe, le n°3, env. 20 minutes.')).toBe('La première lampe, le numéro 3, environ 20 minutes.')
  })

  it('ne touche ni aux mots ni aux nombres qui ne sont pas des mesures', () => {
    const plain = 'Les volets 3-5 du Salon sont ouverts depuis hier, 2 lampes allumées, tout va bien.'
    expect(fr(plain)).toBe(plain)
    expect(fr('Chambre 2 : 2 heures restantes.')).toBe('Chambre 2 : 2 heures restantes.')
  })
})

describe('texte réécrit pour la voix, en anglais', () => {
  it('ses unités et son pluriel (singulier pour 1 seulement), les heures laissées au moteur', () => {
    expect(en('It is 1.5 °C outside, -2 °C tonight.')).toBe('It is 1.5 degrees Celsius outside, minus 2 degrees Celsius tonight.')
    expect(en('Battery at 80 %, 1 kW now, approx 12 kWh today.')).toBe('Battery at 80 percent, 1 kilowatt now, approximately 12 kilowatt hours today.')
    expect(en('Leaving at 8:30.')).toBe('Leaving at 8:30.')
  })
})

describe('les mots de la maison (abréviations des niveaux)', () => {
  it('dits en entier, dans toutes les langues, avant les tables', () => {
    expect(spokenText('Le R+1 et le SS sont éteints.', 'fr', { 'R+1': 'Premier étage', SS: 'Sous-sol' })).toBe('Le Premier étage et le Sous-sol sont éteints.')
    expect(spokenText('RDC is dark.', 'de', { RDC: 'Erdgeschoss' })).toBe('Erdgeschoss is dark.')
  })

  it('casse respectée, et rien d’un seul signe ou sans lettre : ni « et », ni les nombres', () => {
    const words = { ET: 'Étage', E: 'Étage', 1: 'Premier' }
    expect(spokenText('Le salon et 1 chambre, E.', 'fr', words)).toBe('Le salon et 1 chambre, E.')
    expect(spokenText('Le ET est éteint.', 'fr', words)).toBe('Le Étage est éteint.')
  })
})

describe('les tables de correspondances', () => {
  it('une langue sans table passe telle quelle', () => {
    expect(spokenText('Es ist 21 °C um 8h00.', 'de')).toBe('Es ist 21 °C um 8h00.')
  })

  it('chaque mot de chaque langue est remplacé, quelle que soit sa place', () => {
    for (const [language, rules] of Object.entries(SPOKEN_RULES)) {
      for (const [word, said] of Object.entries(rules.words)) {
        expect(spokenText(`a ${word} 3 b`, language), `${language} « ${word} »`).toBe(`a ${said} 3 b`)
      }
    }
  })

  it('chaque unité de chaque langue est remplacée, collée au nombre ou non', () => {
    for (const [language, rules] of Object.entries(SPOKEN_RULES)) {
      for (const [unit, [, many]] of Object.entries(rules.units)) {
        expect(spokenText(`a 12 ${unit} b`, language), `${language} « ${unit} »`).toBe(`a 12 ${many} b`)
        expect(spokenText(`a 12${unit} b`, language), `${language} « ${unit} »`).toBe(`a 12 ${many} b`)
      }
    }
  })
})
