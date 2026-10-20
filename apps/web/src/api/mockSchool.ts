import type { SchoolData, SchoolHomework, Transport } from './transport'

// A demonstration class for simulated mode: the shape of the `toutemonannee` plugin's responses,
// dated around today, invented names. Writes stay in memory.

const pad = (n: number) => String(n).padStart(2, '0')
function day(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const at = (offset: number, time: string) => `${day(offset)}T${time}`

const J = 'demo-ce1-ce2'

function demo(): SchoolData {
  const hw = (h: Partial<SchoolHomework> & Pick<SchoolHomework, 'id' | 'date' | 'text'>): SchoolHomework => ({
    journalId: J, title: 'devoirs', subject: null, author: 'Mme Martin', levels: [], files: [], done: false, siteAck: null, ...h,
  })
  return {
    linked: true, username: 'parent@example.org', sessionLost: false, fetchedAt: Date.now(), error: null,
    journals: [{ id: J, name: 'CE1-CE2', years: '2026-2027', students: ['Lou'] }],
    homework: [
      hw({ id: 1, date: day(-2), title: 'évaluations nationales', text: 'Signer les évaluations nationales (pochette bleue).', done: true }),
      hw({ id: 2, date: day(1), title: 'devoirs ce1', text: "pour les ce1 : faire l'exercice de maths (cahier panda)", levels: ['CE1'] }),
      hw({ id: 3, date: day(1), author: 'Mme Durand', text: 'CE2 :\nexercice + leçon sur les polygones\nleçon orthographe O4\nmots de dictée', levels: ['CE2'] }),
      hw({ id: 4, date: day(2), author: 'Mme Durand', text: 'CE2 :\nleçon vocabulaire V3', levels: ['CE2'] }),
      hw({ id: 5, date: day(4), title: null, subject: 'Français', text: "pour les CE2 : relire le texte de l'enlouve, partie lecture du cahier", levels: ['CE2'], siteAck: { validated: 2, total: 33 } }),
      hw({ id: 6, date: day(4), text: 'pour les CE2 :\n- revoir la leçon G2 et faire les exercices sur le verbe et son infinitif (panda)\n- relire la leçon Sciences 1 : origine des aliments.\n\nSigner les cahiers du jour (bleu).', levels: ['CE2'] }),
    ],
    messages: [
      { id: 11, journalId: J, at: at(-3, '17:09'), title: 'Journée du sport : marche dans le village', author: 'Mme Durand', text: 'Dans le cadre de la journée du sport, la classe marchera dans le village jeudi matin. Prévoir des chaussures adaptées et une gourde.', levels: [], files: [], read: false, responses: 0 },
      { id: 12, journalId: J, at: at(-20, '08:30'), title: 'Infos diverses', author: 'Mme Martin', text: 'Bonjour à tous,\nles cahiers de liaison sont à signer chaque semaine.\nMerci.', levels: [], files: [], read: true, responses: 0 },
    ],
    posts: [
      { id: 21, journalId: J, at: at(-1, '10:48'), title: 'Matériel de vote', author: 'Mme Bernard', text: "Les élections des représentants de parents ont lieu vendredi. Le matériel de vote est dans le cartable de l'aîné.", levels: [], files: [], comments: 0 },
      { id: 20, journalId: J, at: at(-9, '09:58'), title: 'Vente de crêpes', author: 'Mme Bernard', text: "L'association des parents organise une vente de crêpes à la sortie de l'école.", levels: [], files: [], comments: 2 },
    ],
    filters: { hiddenJournals: [], hiddenLevels: [] },
    postsSeen: 20,
  }
}

type SchoolMethods = Pick<Transport, 'schoolData' | 'schoolLogin' | 'schoolLogout' | 'schoolRefresh' | 'schoolSetDone' | 'schoolSetFilters' | 'schoolSeenPosts'>

export function createMockSchool(): SchoolMethods {
  let data = demo()
  const snap = async () => structuredClone(data)
  return {
    schoolData: snap,
    async schoolLogin() { data = demo(); return snap() },
    async schoolLogout() { data = { ...demo(), linked: false, username: null, journals: [], homework: [], messages: [], posts: [] }; return snap() },
    async schoolRefresh() { data = { ...data, fetchedAt: Date.now() }; return snap() },
    async schoolSetDone(_journalId, id, done) {
      data = {
        ...data,
        homework: data.homework.map((h) => (h.id !== id ? h : {
          ...h, done,
          siteAck: h.siteAck && h.done !== done ? { ...h.siteAck, validated: h.siteAck.validated + (done ? 1 : -1) } : h.siteAck,
        })),
      }
      return snap()
    },
    async schoolSetFilters(filters) { data = { ...data, filters }; return snap() },
    async schoolSeenPosts(id) { data = { ...data, postsSeen: Math.max(data.postsSeen, id) }; return snap() },
  }
}
