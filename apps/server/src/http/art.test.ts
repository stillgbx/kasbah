import { describe, expect, it } from 'vitest'
import { isRasterImage, isWebUrl } from './art'

describe('relayed cover art', () => {
  it('accepts only the image types a browser just draws', () => {
    for (const type of ['image/jpeg', 'image/PNG', 'image/webp; charset=binary', 'image/x-icon', 'image/avif']) expect(isRasterImage(type), type).toBe(true)
    for (const type of ['image/svg+xml', 'text/html', 'application/xhtml+xml', 'text/xml', 'application/octet-stream', '']) expect(isRasterImage(type), type).toBe(false)
  })

  it('remembers only http(s) addresses', () => {
    for (const url of ['https://example.org/a.jpg', 'http://192.168.1.10:1400/getaa?u=x']) expect(isWebUrl(url), url).toBe(true)
    for (const url of ['data:image/svg+xml,<svg/>', 'data:text/html,<script>x</script>', 'javascript:alert(1)', 'file:///etc/passwd', '/relative.jpg', '', null, undefined]) {
      expect(isWebUrl(url), String(url)).toBe(false)
    }
  })
})
