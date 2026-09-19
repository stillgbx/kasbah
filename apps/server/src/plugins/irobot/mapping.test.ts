import { describe, expect, it } from 'vitest'
import { errorText, readMissionStatus, toActivity, toDescriptor, toRobotCommands, toStatePatch } from './mapping'
import { BIN_FULL, CLEANING, DOCKED, DOCKED_MISSION_OPEN, MOP_ATTACHED, PAUSED, RETURNING, STUCK, TANK_REMOVED } from './__fixtures__/shadows'

const BLID = '1111111111111111111111111111AAAA'

describe('toActivity', () => {
  it('lit les cinq états d une séquence réellement jouée', () => {
    expect(toActivity(readMissionStatus(PAUSED))).toBe('paused')
    expect(toActivity(readMissionStatus(RETURNING))).toBe('returning')
    expect(toActivity(readMissionStatus(DOCKED))).toBe('docked')
    expect(toActivity(readMissionStatus(CLEANING))).toBe('cleaning')
    expect(toActivity(readMissionStatus(STUCK))).toBe('error')
  })

  /**
   * Le test qui compte. À l'arrivée sur la base, le robot passe `phase: "charge"` QUATRE SECONDES
   * avant de refermer sa mission (`cycle: "none"`) — mesuré le 19/09 à 14:30:33 puis 14:30:37.
   * Un mappage qui déciderait sur `cycle` d'abord publierait « en pause » sur un robot à quai.
   */
  it('ne publie pas « en pause » pour un robot posé dont la mission n est pas encore refermée', () => {
    expect(readMissionStatus(DOCKED_MISSION_OPEN)).toMatchObject({ cycle: 'clean', phase: 'charge' })
    expect(toActivity(readMissionStatus(DOCKED_MISSION_OPEN))).toBe('docked')
  })

  it('distingue « arrêté avec une mission ouverte » de « arrêté sans mission »', () => {
    expect(toActivity({ phase: 'stop', cycle: 'clean' })).toBe('paused')
    expect(toActivity({ phase: 'stop', cycle: 'none' })).toBe('docked')
  })

  it('une erreur prime sur toute phase', () => {
    expect(toActivity({ phase: 'run', cycle: 'clean', error: 17 })).toBe('error')
  })

  it('rend le repos plutôt que de lever sur une phase inconnue du fabricant', () => {
    expect(toActivity({ phase: 'une-phase-que-le-firmware-inventera', cycle: 'none' })).toBe('docked')
    expect(toActivity({})).toBe('docked')
  })
})

describe('readMissionStatus', () => {
  it('survit à une ombre vide ou mal formée — le robot parle en deltas', () => {
    expect(readMissionStatus({})).toEqual({})
    expect(readMissionStatus({ cleanMissionStatus: null })).toEqual({})
    expect(readMissionStatus({ cleanMissionStatus: 'bruit' })).toEqual({})
  })

  it('ignore un champ dont le type surprend au lieu de perdre les autres', () => {
    expect(readMissionStatus({ cleanMissionStatus: { phase: 'run', error: 'zéro' } })).toEqual({ phase: 'run' })
  })
})

describe('toStatePatch', () => {
  it('publie exactement ce que le contrat `vacuum` porte, et rien de plus', () => {
    expect(toStatePatch(DOCKED)).toEqual({
      activity: 'docked', battery: 100, binFull: false, errorMessage: null,
      mopAttached: false, tankLevel: 10,
    })
  })

  it('remonte le bac plein', () => {
    expect(toStatePatch(BIN_FULL)).toMatchObject({ binFull: true })
  })

  it('traduit le code d erreur du fabricant, et efface le message quand il n y en a plus', () => {
    expect(toStatePatch(STUCK)).toMatchObject({ activity: 'error', errorMessage: 'Path blocked' })
    expect(toStatePatch(CLEANING).errorMessage).toBeNull()
  })

  it('omet la batterie tant que le robot ne l a pas dite, plutôt que d inventer un zéro', () => {
    expect(toStatePatch({ cleanMissionStatus: { phase: 'run', cycle: 'clean' } })).toEqual({ activity: 'cleaning', errorMessage: null })
  })

  it('borne la batterie au pour cent', () => {
    expect(toStatePatch({ batPct: 140 }).battery).toBe(100)
    expect(toStatePatch({ batPct: -3 }).battery).toBe(0)
    expect(toStatePatch({ batPct: 84.6 }).battery).toBe(85)
  })
})

describe('serpillière', () => {
  it('lit le patin sur les DEUX valeurs observées du vrai robot', () => {
    expect(toStatePatch(DOCKED).mopAttached).toBe(false)          // detectedPad: "invalid"
    expect(toStatePatch(MOP_ATTACHED).mopAttached).toBe(true)     // detectedPad: "reusableWet"
  })

  /**
   * Règle de lecture volontairement permissive : seul `invalid` signifie « pas de patin ». Les
   * valeurs de patin sec ou jetable n'ont pas été observées, et une liste blanche devinée
   * refuserait un patin bien présent.
   */
  it('tient pour un patin toute valeur qui n est pas `invalid`', () => {
    expect(toStatePatch({ detectedPad: 'dispDry' }).mopAttached).toBe(true)
    expect(toStatePatch({ detectedPad: 'une-valeur-que-le-firmware-inventera' }).mopAttached).toBe(true)
  })

  it('rend le niveau d eau en pour cent', () => {
    expect(toStatePatch(MOP_ATTACHED).tankLevel).toBe(10)
    expect(toStatePatch({ tankLvl: 140 }).tankLevel).toBe(100)
    expect(toStatePatch({ tankLvl: 63.4 }).tankLevel).toBe(63)
  })

  it('EFFACE le niveau quand le réservoir est retiré, au lieu de garder une valeur périmée', () => {
    expect(toStatePatch(TANK_REMOVED).tankLevel).toBeNull()
  })

  it('ne dit rien de la serpillière quand le robot n en parle pas', () => {
    const patch = toStatePatch({ batPct: 50 })
    expect(patch.mopAttached).toBeUndefined()
    expect(patch.tankLevel).toBeUndefined()
  })
})

describe('canMop', () => {
  it('déclare `mop` au robot qui annonce savoir laver', () => {
    expect(toDescriptor({ blid: BLID }, MOP_ATTACHED).capabilities).toEqual(['clean', 'dock', 'battery', 'locate', 'mop'])
  })

  it('ne la déclare pas à un Roomba sec — sa carte n aurait rien à y mettre', () => {
    expect(toDescriptor({ blid: BLID, cap: { scrub: 0 } }).capabilities).toEqual(['clean', 'dock', 'battery', 'locate'])
    expect(toDescriptor({ blid: BLID }).capabilities).toEqual(['clean', 'dock', 'battery', 'locate'])
  })
})

describe('toDescriptor', () => {
  it('nomme le robot comme lui-même se nomme, et déclare ses quatre capacités', () => {
    expect(toDescriptor({ blid: BLID, name: 'nom du compte', sku: null }, DOCKED)).toEqual({
      id: `irobot:${BLID}`,
      pluginId: 'irobot',
      externalId: BLID,
      kind: 'vacuum',
      name: 'Robby',
      capabilities: ['clean', 'dock', 'battery', 'locate', 'mop'],
      meta: { manufacturer: 'iRobot', model: 'c755840' },
    })
  })

  it('garde le nom du compte tant que le robot n a pas parlé — un robot éteint reste nommé', () => {
    expect(toDescriptor({ blid: BLID, name: 'Robby', sku: 'c755840' })).toMatchObject({ name: 'Robby', meta: { model: 'c755840' } })
  })

  it('se rabat sur un nom générique quand personne ne sait', () => {
    expect(toDescriptor({ blid: BLID }).name).toBe('Roomba')
  })
})

describe('toRobotCommands', () => {
  it('traduit le bouton unique du contrat en `start` ou `resume` selon l activité', () => {
    expect(toRobotCommands('vacuum.start', 'docked')).toEqual(['start'])
    expect(toRobotCommands('vacuum.start', 'paused')).toEqual(['resume'])
  })

  /**
   * Le robot ACCEPTE un `dock` en pleine mission et ne fait rien — mesuré sur Robby le 19/09 à
   * 14:58 : `lastCommand` enregistré, `phase: "run"` deux minutes et demie plus tard. Il faut
   * l'arrêter d'abord. Sans ce test, le bouton « Retour base » remarcherait en silence.
   */
  it('arrête le robot AVANT de le renvoyer, parce qu un `dock` en pleine mission est ignoré', () => {
    expect(toRobotCommands('vacuum.dock', 'cleaning')).toEqual(['pause', 'dock'])
  })

  it('n arrête rien quand le robot ne nettoie pas : un seul `dock` suffit', () => {
    expect(toRobotCommands('vacuum.dock', 'paused')).toEqual(['dock'])
    expect(toRobotCommands('vacuum.dock', 'returning')).toEqual(['dock'])
    expect(toRobotCommands('vacuum.dock', 'error')).toEqual(['dock'])
  })

  it('traduit les deux gestes restants', () => {
    expect(toRobotCommands('vacuum.pause', 'cleaning')).toEqual(['pause'])
    expect(toRobotCommands('vacuum.locate', 'docked')).toEqual(['find'])
  })

  it('refuse ce que le robot ne sait pas faire', () => {
    expect(toRobotCommands('light.on', 'docked')).toBeNull()
    expect(toRobotCommands('mower.park', 'docked')).toBeNull()
  })
})

describe('errorText', () => {
  it('rend le texte du fabricant quand on le connaît', () => {
    expect(errorText(17)).toBe('Path blocked')
  })

  it('rend le NUMÉRO plutôt qu un libellé inventé pour un code inconnu', () => {
    expect(errorText(199)).toBe('Error 199')
  })
})
