// CAPTURES RÉELLES (2026-09-10) de l'API REST locale d'une Sony BRAVIA XR-65A80L (« TV Salon »), sans clé
// PSK : YouTube Music jouait à l'écran, le son sortait par HDMI eARC vers une barre de son Klipsch Flexus
// Core 300 — que la TV connaît par CEC sous « Flexus 300 ». Étiquettes d'entrées gardées telles quelles.

/** `audio.getSoundSettings` `[{ target: 'outputTerminal' }]` : le son part vers le système audio. */
export const BRAVIA_SOUND_AUDIO_SYSTEM = { result: [[{ target: 'outputTerminal', currentValue: 'audioSystem' }]], id: 3 }
/** Même question, TV réglée sur ses propres haut-parleurs. */
export const BRAVIA_SOUND_SPEAKER = { result: [[{ target: 'outputTerminal', currentValue: 'speaker' }]], id: 3 }
/** Méthode refusée sans clé (forme d'une erreur de cette API). */
export const BRAVIA_FORBIDDEN = { auth_url: { default: 'http://192.168.1.87:80/sony/webauth/auth_default' }, error: [403, 'Forbidden'], id: 5 }

/** `avContent.getCurrentExternalInputsStatus` : la barre sur HDMI 3 (eARC/ARC), connectée, nommée par CEC. */
export const BRAVIA_INPUTS_ARC_SOUNDBAR = {
  result: [[
    { uri: 'extInput:cec?type=player&port=4&logicalAddr=4', title: 'PlayStation 5', connection: true, label: '', icon: 'meta:playbackdevice', status: '' },
    { uri: 'extInput:cec?type=freeuse&port=3&logicalAddr=5', title: 'Flexus 300', connection: true, label: '', icon: 'meta:freeuse', status: '' },
    { uri: 'extInput:hdmi?port=1', title: 'HDMI 1', connection: false, label: 'Décodeur TV ', icon: 'meta:hdmi', status: 'false' },
    { uri: 'extInput:hdmi?port=2', title: 'HDMI 2', connection: false, label: 'PC', icon: 'meta:hdmi', status: 'false' },
    { uri: 'extInput:hdmi?port=3', title: 'HDMI 3 (eARC/ARC)', connection: true, label: 'Barre de son ', icon: 'meta:hdmi', status: 'false' },
    { uri: 'extInput:hdmi?port=4', title: 'HDMI 4', connection: false, label: 'PS5', icon: 'meta:hdmi', status: 'false' },
    { uri: 'extInput:composite?port=1', title: 'AV', connection: false, label: '', icon: 'meta:composite', status: '' },
  ]],
  id: 7,
}
