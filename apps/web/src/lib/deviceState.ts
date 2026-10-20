import type { CommandInput, DeviceDescriptor, DeviceState, StateFor } from '@kasbah/shared'
import { isDeviceOn, isMediaActive } from '@kasbah/shared'
import { coverRestKey, coverWords, toClosure } from './cover'
import { isEnergySite } from './energy'
import { formatFeedAmount, formatMilliliters, formatPercent, formatPower, formatSensor, formatTemp, waterAlertState, waterLowestPct } from './format'

// "Business" reading of a state: active?, quick toggle possible?, short translated label.
// `isDeviceOn` / `isMediaActive` live in `@kasbah/shared` (the server uses them too): re-exported here.
export { isDeviceOn, isMediaActive }

/**
 * Value DISPLAYED by the switch, which is not always "the device is active".
 * For a cover, the interface's convention is closure (checked = closed), aligned with that
 * of the slider — see `cover.ts`. `isDeviceOn` answers another question: it serves the tint of
 * the icon, the count of active devices in a room and the 3D markers, where what is noticed
 * is an OPEN shutter — but a DEPLOYED blind (`coverActivity`).
 *
 * `aimed`: AIMED position when the store holds one. The switch then toggles right away,
 * like the slider — otherwise it would stay in its old state during the ~20 s of travel before
 * jumping at the end, although the gesture was indeed taken into account.
 */
export function toggleChecked(s: DeviceState, aimed?: number): boolean {
  if (s.kind === 'cover') return s.available && shownClosed(s, aimed)
  return isDeviceOn(s)
}

/**
 * Is the cover shown AS CLOSED (switch checked)? Unknown position = not checked: we cannot
 * assert "closed", and the switch stays operable in that direction — it is also the useful
 * toggle, since `toggleCommand` derives the inverse command from it.
 */
function shownClosed(s: StateFor<'cover'>, aimed?: number): boolean {
  const shown = aimed ?? s.position
  return shown !== undefined && shown <= 0
}

/**
 * Is the device BUSY executing what it was asked? Not to be confused with "a
 * request is in flight": a vendor acknowledges in a few tens of milliseconds, and an
 * indicator that only lasts that long is not readable. For a cover, the command is only the
 * start — the busyness runs until the end of the travel.
 *
 * `aiming`: a position is aimed but the motor has not yet signaled that it is starting (the store
 * holds this target, see `stores/devices.ts`).
 */
export function isDeviceBusy(s: DeviceState, aiming = false): boolean {
  if (s.kind === 'cover') return aiming || s.motion !== 'stopped'
  return false
}

/**
 * Pulsing dot of the lists: something is IN PROGRESS at the device — a cover moving, a
 * player playing. Distinct from `isDeviceBusy`, which replaces the panel's switch by a
 * spinner: playback does not prevent acting, it must not hide the toggle.
 */
export function isDevicePulsing(s: DeviceState, aiming = false): boolean {
  return isDeviceBusy(s, aiming) || (s.kind === 'media_player' && isMediaActive(s))
}

/**
 * Quick toggle command (switch of the lists), or null if the device has none.
 *
 * `aimed`: aimed position when the store holds one. Without it, a cover in the middle of closing
 * keeps its real starting position, so the toggle would send "close" AGAIN — impossible
 * to reverse a movement in progress. We therefore reason on what the interface shows.
 */
export function toggleCommand(s: DeviceState, aimed?: number): CommandInput | null {
  switch (s.kind) {
    case 'light': return { type: 'light.set', on: !s.on }
    case 'cover': return shownClosed(s, aimed) ? { type: 'cover.open' } : { type: 'cover.close' }
    // `on`: the switch is checked; turning it off CLOSES the on-screen app (nothing else is possible without a session)
    case 'media_player': return s.playback === 'playing' ? { type: 'media_player.pause' } : s.playback === 'on' ? { type: 'media_player.stop' } : { type: 'media_player.play' }
    case 'vacuum': return s.activity === 'cleaning' ? { type: 'vacuum.dock' } : { type: 'vacuum.start' }
    case 'mower': return s.activity === 'mowing' ? { type: 'mower.park', untilNextSchedule: true } : { type: 'mower.start', durationMin: 60 }
    case 'fan': return { type: 'fan.set', on: !s.on }
    default: return null
  }
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Time of day alone ("19:00"): a meal tonight does not need to carry its date. */
function timeOfDay(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
}

/** Short state label for the lists and the device panel header. */
export function statusLabel(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  if (!s.available) return t('common.unavailable')
  switch (s.kind) {
    case 'light': return s.on ? `${t('common.on')}${s.brightness !== undefined ? ` · ${formatPercent(s.brightness, locale)}` : ''}` : t('common.off')
    // in motion, the position is being left: announcing the movement avoids an
    // "Open" displayed next to a slider already set on the aimed closure. The vocabulary
    // depends on the cover's nature: a blind is "lowered", not "closed".
    case 'cover': {
      const w = coverWords(descriptor)
      // Unknown position: we show the state we ASSUME (rest, `coverAtRest`) rather than a mute
      // "Unknown" — it is already what decides the group gestures and the scene's drawing.
      // The "(assumed)" is what prevents the word from becoming an assertion.
      return s.motion !== 'stopped' ? t(`cover.${w}.${s.motion}`)
        : s.position === undefined ? t('cover.assumed', { state: t(coverRestKey(descriptor)) })
        : s.position <= 0 ? t(`cover.${w}.closed`)
        : s.position >= 100 ? t(`cover.${w}.open`)
        : formatPercent(toClosure(s.position), locale)
    }
    // `on`: the app is on screen without saying anything more — it is the one we name ("On screen · Netflix").
    // Playing without a title (native app of a TV: Prime Video), we name it too: "Playing · Prime Video".
    case 'media_player': return s.playback === 'playing' ? `${t('media.playing')}${s.nowPlaying?.title || s.nowPlaying?.source ? ` · ${s.nowPlaying?.title || s.nowPlaying?.source}` : ''}`
      : s.playback === 'on' && s.nowPlaying?.source ? `${t('media.on')} · ${s.nowPlaying.source}`
      : t(`media.${s.playback}`)
    // when off, no setpoint applies: we do not show it
    case 'climate': return s.mode === 'off' ? formatTemp(s.currentTempC, locale) : `${formatTemp(s.currentTempC, locale)} → ${formatTemp(s.targetTempC, locale)}`
    case 'vacuum': return `${t(`vacuum.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'mower': return `${t(`mower.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    // an installation publishes the SITE and one battery per unit: the site reads as production,
    // a battery as charging, and "0 W" for a full battery would say nothing
    case 'energy': return isEnergySite(descriptor) ? formatPower(s.productionW, locale) : batteryStatus(s, t, locale)
    case 'ev_charger': return s.status === 'charging' ? formatPower(s.powerW, locale) : t(`charger.status.${s.status}`)
    case 'vehicle': return `${formatPercent(s.soc, locale)} · ${Math.round(s.rangeKm)} km`
    // nothing else to say about a camera than its presence: the API publishes neither on/off nor activity
    case 'camera': return t('camera.online')
    case 'weather': return t(`weather.conditions.${s.condition}`)
    case 'water': return waterAlertLabel(s, t)
    // Priority order: the fault, then what calls for a gesture (filling the hopper), then what
    // is happening, then the day's figure. One fact at a time — it is a line, not a table.
    case 'pet_feeder': {
      if (s.errorMessage) return s.errorMessage
      if (s.feeding) return t('pets.feeding')
      if (s.foodLow) return t('pets.foodLow')
      // What neither the big value (what was served) nor the card's first line (the hopper)
      // say: WHEN the next meal falls. This is what the vendor's app highlights on
      // its thumbnail, and the only piece of information that speaks of the future.
      if (s.nextMealAt !== undefined) return t('pets.nextMeal', { time: timeOfDay(s.nextMealAt, locale) })
      return t('pets.noMealLeft')
    }
    case 'pet_fountain': {
      if (s.errorMessage) return s.errorMessage
      if (s.waterLow) return t('pets.waterLow')
      if (!s.on) return t('pets.pumpStopped')
      return s.mode ? t(`pets.mode.${s.mode}`) : t('common.on')
    }
    case 'fan': {
      if (!s.on) return t('common.off')
      const parts = [t('common.on')]
      if (s.speed !== undefined) parts.push(t('fan.speedN', { n: s.speed }))
      return parts.join(' · ')
    }
  }
}

/** Alert word of a water station (see `waterAlertState`): the fact most worthy of attention, like a robot's activity. */
function waterAlertLabel(s: StateFor<'water'>, t: Translate): string {
  const a = waterAlertState(s)
  return a === 'ok' ? t('water.noAlert') : a === 'warning' ? t('water.warning') : a === 'defect' ? t('water.defect') : t('common.unknown')
}

/**
 * What a battery says about itself: its charge, and the direction it works in when it
 * works. The contract counts `batteryW` as positive when CHARGING.
 */
function batteryStatus(s: StateFor<'energy'>, t: Translate, locale: string): string {
  const soc = s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale) : t('common.unknown')
  if (!s.batteryW) return soc
  return `${soc} · ${t(s.batteryW > 0 ? 'energy.charging' : 'energy.discharging')} ${formatPower(Math.abs(s.batteryW), locale)}`
}

/** Big value at the top of the device panel. */
export function headlineValue(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  switch (s.kind) {
    case 'light': return s.on ? (s.brightness !== undefined ? formatPercent(s.brightness, locale) : t('common.on')) : t('common.off')
    // A cover that cannot AIM at a position cannot measure it either: on a one-way
    // radio (RTS), the percentage is only a deduction from the last full-travel command.
    // Writing "100 %" for a blind stopped at mid-height is an invented precision —
    // we only say the word, which stays true. Two-way motors keep their percentage.
    case 'cover': {
      // the big value carries the assumed word; it is the status line just below that says
      // it is an assumption (`CoverControl`), the "(assumed)" would not fit in 32 px
      if (s.position === undefined) return t(coverRestKey(descriptor))
      if (!descriptor.capabilities.includes('position')) {
        const w = coverWords(descriptor)
        return t(`cover.${w}.${s.position <= 0 ? 'closed' : 'open'}`)
      }
      return formatPercent(toClosure(s.position), locale)
    }
    // empty title = metadata not yet received: the state, rather than a blank or an identifier
    case 'media_player': return s.nowPlaying?.title || t(`media.${s.playback}`)
    case 'climate': return formatTemp(s.currentTempC, locale)
    case 'vacuum': return t(`vacuum.activities.${s.activity}`)
    case 'mower': return t(`mower.activities.${s.activity}`)
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return isEnergySite(descriptor) ? formatPower(s.productionW, locale)
      : s.batterySoc !== undefined ? formatPercent(s.batterySoc, locale) : t('common.unknown')
    case 'ev_charger': return formatPower(s.powerW, locale)
    case 'vehicle': return formatPercent(s.soc, locale)
    case 'camera': return t(`camera.classes.${descriptor.meta.camera?.deviceClass ?? 'camera'}`)
    case 'weather': return formatTemp(s.tempC, locale)
    // The card's bottom line already says the alert: the big value would repeat the same word. Unless
    // an alert is active — the most urgent fact must prevail — it says instead the lowest
    // of the consumables (`waterLowestPct`), which nothing else on screen sums up.
    case 'water': {
      const a = waterAlertState(s)
      if (a === 'warning' || a === 'defect') return waterAlertLabel(s, t)
      const p = waterLowestPct(s)
      return p !== undefined ? formatPercent(p, locale) : t('common.unknown')
    }
    // Same trade-off as the water station: an alert prevails over the figure, because it calls for
    // a gesture; otherwise we show what the day has given, which is written nowhere else.
    // Unlike the water station, the alert does NOT take the figure's place: it is the status line
    // just below that carries it, and writing it in both places displayed it twice.
    case 'pet_feeder': {
      const u = descriptor.meta.petFeeder?.unit
      return s.servedToday !== undefined && u ? formatFeedAmount(s.servedToday, u, locale) : t('common.unknown')
    }
    case 'pet_fountain': {
      if (!s.on) return t('common.off')
      // The day's PASSES: this is what the vendor's app shows large ("6 times"), and the
      // only consumption measure an Eversweet Max can produce. The volume for the
      // models that measure it; otherwise the filter, the only figure that calls for a gesture.
      // COMPACT form ("6×") and not "6 passes": the big value is at 32 px in a
      // reserve of 144, and the word got cut there ("0 pass…", measured). The full label lives on
      // the card's line, where it has room.
      if (s.drinksToday !== undefined) return `${s.drinksToday}×`
      if (s.todayMl !== undefined) return formatMilliliters(s.todayMl, locale)
      return s.filterPct !== undefined ? formatPercent(s.filterPct, locale) : t('common.on')
    }
    case 'fan': return s.on
      ? (s.speed !== undefined ? String(s.speed) : t('common.on'))
      : t('common.off')
  }
}
