import { describe, expect, it } from 'vitest'
import { splitCredit } from './wikiCredit'

describe('splitCredit', () => {
  it('détache la source et la licence, sans les URL tronquées', () => {
    expect(splitCredit("Rock des années 1960. Source : Wikipedia (https://fr.wikipedia.org/wiki/Erik_Sa..., licence : Creative Commons Attribution CC-BY-SA 3.0 (http://creativecommons.org/licenses/b...)"))
      .toEqual({ text: 'Rock des années 1960.', credit: 'Source : Wikipedia, licence : Creative Commons Attribution CC-BY-SA 3.0' })
  })
  it("tient une URL qui contient ses propres parenthèses (version anglaise)", () => {
    expect(splitCredit('An EP. From Wikipedia (https://en.wikipedia.org/wiki/Paradise_(EP)) under Creative Commons Attribution CC-BY-SA 3.0 (http://creativecommons.org/licenses/by-sa/3.0/legalcode)'))
      .toEqual({ text: 'An EP.', credit: 'From Wikipedia under Creative Commons Attribution CC-BY-SA 3.0' })
  })
  it('laisse un texte sans mention tel quel', () => {
    expect(splitCredit('Un album sans source.')).toEqual({ text: 'Un album sans source.', credit: null })
    expect(splitCredit(null)).toEqual({ text: null, credit: null })
  })
})
