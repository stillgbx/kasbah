import { describe, expect, it } from 'vitest'
import { MATCH_INSIDE, MATCH_START, MATCH_WORD, normalize, queryTerms, scoreQuery, scoreTerm } from './search'

describe('normalize', () => {
  it('strips accents and case', () => {
    expect(normalize('Chambre Étage')).toBe('chambre etage')
    expect(normalize('  Rez-de-chaussée ')).toBe('rez-de-chaussee')
  })
})

describe('scoreTerm', () => {
  const salon = normalize('Cube Salon')
  it('ranks start of text, start of word, middle of word', () => {
    expect(scoreTerm(salon, 'cube')).toBe(MATCH_START)
    expect(scoreTerm(salon, 'salon')).toBe(MATCH_WORD)
    expect(scoreTerm(salon, 'ube')).toBe(MATCH_INSIDE)
    expect(scoreTerm(salon, 'cuisine')).toBeNull()
  })
  it('splits words on the hyphen and the apostrophe', () => {
    expect(scoreTerm(normalize("Sas d'entrée"), 'entree')).toBe(MATCH_WORD)
    expect(scoreTerm(normalize('Rez-de-chaussée'), 'chaussee')).toBe(MATCH_WORD)
  })
})

describe('scoreQuery', () => {
  const salon = normalize('Cube Salon')
  it('requires all the words and keeps the worst placed one', () => {
    expect(scoreQuery(salon, queryTerms('cube salon'))).toBe(MATCH_WORD)
    expect(scoreQuery(salon, queryTerms('cube ube'))).toBe(MATCH_INSIDE)
    expect(scoreQuery(salon, queryTerms('cube cuisine'))).toBeNull()
  })
  it('answers nothing to an empty query', () => {
    expect(scoreQuery(salon, queryTerms('   '))).toBeNull()
  })
  it('finds the room before the light that names it', () => {
    const room = scoreQuery(normalize('Salon'), queryTerms('salon'))!
    const lamp = scoreQuery(salon, queryTerms('salon'))!
    expect(room).toBeGreaterThan(lamp)
  })
})
