import { describe, expect, it } from 'vitest'
import { splitCredit } from './wikiCredit'

describe('splitCredit', () => {
  it('detaches the source and the license, without the truncated URLs', () => {
    expect(splitCredit("Rock des années 1960. Source : Wikipedia (https://fr.wikipedia.org/wiki/Erik_Sa..., licence : Creative Commons Attribution CC-BY-SA 3.0 (http://creativecommons.org/licenses/b...)"))
      .toEqual({ text: 'Rock des années 1960.', credit: 'Source : Wikipedia, licence : Creative Commons Attribution CC-BY-SA 3.0' })
  })
  it("holds a URL that contains its own parentheses (English version)", () => {
    expect(splitCredit('An EP. From Wikipedia (https://en.wikipedia.org/wiki/Paradise_(EP)) under Creative Commons Attribution CC-BY-SA 3.0 (http://creativecommons.org/licenses/by-sa/3.0/legalcode)'))
      .toEqual({ text: 'An EP.', credit: 'From Wikipedia under Creative Commons Attribution CC-BY-SA 3.0' })
  })
  it('leaves a text without a mention as is', () => {
    expect(splitCredit('Un album sans source.')).toEqual({ text: 'Un album sans source.', credit: null })
    expect(splitCredit(null)).toEqual({ text: null, credit: null })
  })
})
