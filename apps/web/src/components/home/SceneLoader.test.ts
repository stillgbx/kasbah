import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { House } from '@kasbah/shared'
import SceneLoader from './SceneLoader.vue'

// Deux pièces qui se touchent au rez-de-chaussée : huit arêtes, dont une partagée.
const house = {
  levels: [{ id: 'rdc', name: 'Rez-de-chaussée', shortName: 'RDC', elevation: 0 }, { id: 'etage', name: 'Étage', elevation: 2.8 }],
  rooms: [
    { id: 'a', levelId: 'rdc', name: 'A', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { id: 'b', levelId: 'rdc', name: 'B', polygon: [[4, 0], [8, 0], [8, 3], [4, 3]] },
  ],
} as unknown as House

describe('voile de chargement de la vue 3D', () => {
  /** Un mur entre deux pièces n'est tracé qu'une fois : deux traits superposés se liraient en gras. */
  it('trace chaque mur une seule fois, et saute un niveau sans pièce', () => {
    const w = mount(SceneLoader, { props: { house, stage: 'shaders', progress: null } })
    expect(w.findAll('.loader__wall')).toHaveLength(7)
    expect(w.findAll('.loader__floor')).toHaveLength(2)
    expect(w.findAll('.loader__leader')).toHaveLength(0)            // un seul niveau dessiné : rien à relier
    w.unmount()
  })

  it('dit l’étape en cours, avec le compte des matières quand il est connu', () => {
    const w = mount(SceneLoader, { props: { house: null, stage: 'materials', progress: { done: 3, total: 10 } } })
    expect(w.find('.loader__step').text()).toBe('Matières · 3 / 10')
    expect(w.findAll('.loader__wall').length).toBeGreaterThan(0)   // la maison générique, en attendant la vraie
    expect(w.findAll('.loader__leader')).toHaveLength(4)            // deux niveaux : quatre lignes de rappel
    w.unmount()
  })
})
