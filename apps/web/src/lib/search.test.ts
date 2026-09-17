import { describe, expect, it } from 'vitest'
import { MATCH_INSIDE, MATCH_START, MATCH_WORD, normalize, queryTerms, scoreQuery, scoreTerm } from './search'

describe('normalize', () => {
  it('efface accents et casse', () => {
    expect(normalize('Chambre Étage')).toBe('chambre etage')
    expect(normalize('  Rez-de-chaussée ')).toBe('rez-de-chaussee')
  })
})

describe('scoreTerm', () => {
  const salon = normalize('Cube Salon')
  it('classe début de texte, début de mot, milieu de mot', () => {
    expect(scoreTerm(salon, 'cube')).toBe(MATCH_START)
    expect(scoreTerm(salon, 'salon')).toBe(MATCH_WORD)
    expect(scoreTerm(salon, 'ube')).toBe(MATCH_INSIDE)
    expect(scoreTerm(salon, 'cuisine')).toBeNull()
  })
  it('coupe les mots sur le tiret et l’apostrophe', () => {
    expect(scoreTerm(normalize("Sas d'entrée"), 'entree')).toBe(MATCH_WORD)
    expect(scoreTerm(normalize('Rez-de-chaussée'), 'chaussee')).toBe(MATCH_WORD)
  })
})

describe('scoreQuery', () => {
  const salon = normalize('Cube Salon')
  it('exige tous les mots et retient le plus mal placé', () => {
    expect(scoreQuery(salon, queryTerms('cube salon'))).toBe(MATCH_WORD)
    expect(scoreQuery(salon, queryTerms('cube ube'))).toBe(MATCH_INSIDE)
    expect(scoreQuery(salon, queryTerms('cube cuisine'))).toBeNull()
  })
  it('ne répond rien à une requête vide', () => {
    expect(scoreQuery(salon, queryTerms('   '))).toBeNull()
  })
  it('trouve la pièce avant la lampe qui la nomme', () => {
    const room = scoreQuery(normalize('Salon'), queryTerms('salon'))!
    const lamp = scoreQuery(salon, queryTerms('salon'))!
    expect(room).toBeGreaterThan(lamp)
  })
})
