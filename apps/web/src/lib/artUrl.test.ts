import { describe, expect, it } from 'vitest'
import { artAt } from './artUrl'

describe('artAt', () => {
  it('re-requests a Google cover at the desired size', () => {
    expect(artAt('https://lh3.googleusercontent.com/abc=w120-h120-l90-rj', 600)).toBe('https://lh3.googleusercontent.com/abc=w600-h600-l90-rj')
    expect(artAt('https://yt3.googleusercontent.com/abc', 600)).toBe('https://yt3.googleusercontent.com/abc=w600-h600-l90-rj')
  })
  it('takes the closest YouTube variant, and leaves the rest as is', () => {
    expect(artAt('https://i.ytimg.com/vi/x/default.jpg', 600)).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg')
    expect(artAt('https://example.com/a.jpg', 600)).toBe('https://example.com/a.jpg')
    expect(artAt(null, 600)).toBeNull()
  })
})
