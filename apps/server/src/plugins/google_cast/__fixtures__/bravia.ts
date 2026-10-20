// REAL CAPTURES (2026-09-10) of the local REST API of a Sony BRAVIA XR-65A80L ("TV Salon"), without a
// PSK key: YouTube Music was playing on screen, the sound went out over HDMI eARC to a Klipsch Flexus
// Core 300 soundbar — which the TV knows through CEC as "Flexus 300". Input labels kept as they are.

/** `audio.getSoundSettings` `[{ target: 'outputTerminal' }]`: the sound goes to the audio system. */
export const BRAVIA_SOUND_AUDIO_SYSTEM = { result: [[{ target: 'outputTerminal', currentValue: 'audioSystem' }]], id: 3 }
/** Same question, TV set to its own speakers. */
export const BRAVIA_SOUND_SPEAKER = { result: [[{ target: 'outputTerminal', currentValue: 'speaker' }]], id: 3 }
/** Method refused without a key (shape of an error from this API). */
export const BRAVIA_FORBIDDEN = { auth_url: { default: 'http://192.168.1.87:80/sony/webauth/auth_default' }, error: [403, 'Forbidden'], id: 5 }

/** `avContent.getCurrentExternalInputsStatus`: the soundbar on HDMI 3 (eARC/ARC), connected, named by CEC. */
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
