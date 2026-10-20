<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PetFeederCard from '../components/controls/PetFeederCard.vue'
import PetFountainCard from '../components/controls/PetFountainCard.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { headlineValue, statusLabel } from '../lib/deviceState'
import { formatFeedGrams } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { CUP_GRAMS_MAX, CUP_GRAMS_MIN, CUP_GRAMS_STEP, useSettingsStore } from '../stores/settings'

// Pets view: the house's feeders and fountains, one card each.
//
// Two kinds in the same view, as the Robots view brings mower and vacuum together: what unites
// them is not their contract but their use — you come to see whether the cat has eaten and
// drunk, not to drive a device. Feeders first: they carry the only daily gesture (serving a
// portion); fountains are consulted more than they are driven.
//
// Each card reuses the control of the 3D scene's device panel (`PetFeederCard` /
// `PetFountainCard`) rather than redrawing the same rows: a single layout to maintain,
// and the capabilities already decide the sections there.
const devices = useDevicesStore()
const house = useHouseStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()

type FeederEntry = DeviceEntry & { state: StateFor<'pet_feeder'> }
type FountainEntry = DeviceEntry & { state: StateFor<'pet_fountain'> }
const feeders = computed(() => devices.list.filter((e): e is FeederEntry => e.state.kind === 'pet_feeder'))
const fountains = computed(() => devices.list.filter((e): e is FountainEntry => e.state.kind === 'pet_fountain'))
const isEmpty = computed(() => feeders.value.length === 0 && fountains.value.length === 0)

/** The name chosen in the house wins over the vendor's (same rule as the Robots view). */
const displayName = (e: DeviceEntry) => house.houseDeviceFor(e.descriptor.id)?.name ?? e.descriptor.name
const brand = (e: DeviceEntry) => [e.descriptor.meta.manufacturer, e.descriptor.meta.model].filter(Boolean).join(' · ')
const headline = (e: DeviceEntry) => headlineValue(e.descriptor, e.state, t, locale.value)
const status = (e: DeviceEntry) => statusLabel(e.descriptor, e.state, t, locale.value)
/**
 * The gram counterpart of the large value, for a feeder that counts in cups. Small NEXT TO the
 * figure and not below it: a third line would make the header of the feeders alone grow, and the
 * two cards of the row would no longer have the same header height.
 */
function headlineGrams(e: FeederEntry): string {
  const u = e.descriptor.meta.petFeeder?.unit
  if (!u || e.state.servedToday === undefined) return ''
  return formatFeedGrams(e.state.servedToday, u, settings.cupGrams, locale.value) ?? ''
}

async function send(id: string, cmd: CommandInput): Promise<void> {
  await devices.sendCommand(id, cmd)
}
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <div v-if="isEmpty" class="card card--soft empty muted">{{ $t('pets.noDevice') }}</div>

      <div v-else class="pets__grid">
        <section v-for="e in feeders" :key="e.descriptor.id" class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="e.state.available ? '1' : '0'">
              <StrokeIcon name="feeder" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="displayName(e)" />
              <div class="muted hero__sub">{{ brand(e) }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">
                {{ headline(e) }}<span class="hero__grams">{{ headlineGrams(e) }}</span>
              </div>
              <div class="muted hero__status">{{ status(e) }}</div>
            </div>
          </div>
          <PetFeederCard :descriptor="e.descriptor" :state="e.state" :disabled="!e.state.available"
                         :pending="devices.isPending(e.descriptor.id)"
                         @command="(c: CommandInput) => send(e.descriptor.id, c)" />
          <!-- DISPLAY setting, not a command: the feeder counts in volume and weighs
               nothing. That figure is only known to the user, who weighs a portion once.
               Discreet, at the foot of the card, like the household size on the Water view. -->
          <div v-if="e.descriptor.meta.petFeeder?.unit === 'cup'" class="hero__cup" :title="$t('pets.cupGramsHint')">
            <span class="muted">{{ $t('pets.cupGrams') }}</span>
            <div class="stepper">
              <button type="button" class="stepper__btn" :disabled="settings.cupGrams <= CUP_GRAMS_MIN"
                      :aria-label="$t('pets.cupGramsDec')" @click="settings.setCupGrams(settings.cupGrams - CUP_GRAMS_STEP)">
                <StrokeIcon name="minus" :size="14" />
              </button>
              <span class="stepper__val">{{ settings.cupGrams }} g</span>
              <button type="button" class="stepper__btn" :disabled="settings.cupGrams >= CUP_GRAMS_MAX"
                      :aria-label="$t('pets.cupGramsInc')" @click="settings.setCupGrams(settings.cupGrams + CUP_GRAMS_STEP)">
                <StrokeIcon name="plus" :size="14" />
              </button>
            </div>
          </div>
        </section>

        <section v-for="e in fountains" :key="e.descriptor.id" class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="e.state.available ? '1' : '0'">
              <StrokeIcon name="fountain" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="displayName(e)" />
              <div class="muted hero__sub">{{ brand(e) }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">{{ headline(e) }}</div>
              <div class="muted hero__status">{{ status(e) }}</div>
            </div>
          </div>
          <PetFountainCard :descriptor="e.descriptor" :state="e.state" :disabled="!e.state.available"
                           :pending="devices.isPending(e.descriptor.id)"
                           @command="(c: CommandInput) => send(e.descriptor.id, c)" />
        </section>
      </div>

      <RoomBands :kind="['pet_feeder', 'pet_fountain']" />
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* Same threshold as the Water view (1040px, measured there): the card header reserves
   a fixed width on the right (value + status), and below it the brand would wrap onto two lines. */
.pets__grid { display: grid; gap: 20px; min-width: 0; }
@media (min-width: 1040px) { .pets__grid { grid-template-columns: 1fr 1fr; } }
.hero { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.hero__head { display: flex; align-items: center; gap: 12px; }
.hero__main { flex: 1 1 auto; min-width: 0; }
.hero__name { font-size: 15px; font-weight: 600; }
.hero__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
/* RESERVED width, not adjusted to the content: without it, "Trémie garnie" (76 px measured)
   becoming "Croquettes à remettre" (128 px) makes `.hero__main` shrink from 484 to 432 px and
   the device name starts to scroll — the house moves under a value that changes on its own.
   208 px covers the worst case of BOTH languages, measured with `getBoundingClientRect()`: 128 px
   for the longest status (FR "Croquettes à remettre"), and above all the large value followed by
   its weight equivalent — "1,0 tasse ~ 100 g" just fits in 196, and "12,0 tasse ~ 1 200 g"
   needs 201. The margin is there for a household with several cats, not for looks. */
/* `min-width: 0` is NOT decorative: the automatic minimum size of a flex item equals its
   min-content width, and the status is `nowrap` — without it, a vendor error message
   takes the reserve from 144 to 295 px (measured), exactly the shift it prevents. */
.hero__stat { flex: 0 0 208px; min-width: 0; max-width: 208px; text-align: right; }
.hero__value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* The weight equivalent, small and discreet, on the SAME line as the large value: it qualifies it
   without stealing the show or adding a line to the header. */
.hero__grams { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 6px; white-space: nowrap; }
/* The status may carry the vendor's RAW error message, of unknown length: it is cut
   rather than carrying the reserve away with it. */
.hero__status { font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Display setting, separated from the data above by a hairline — the same pattern as the household
   size on the Water view. */
.hero__cup { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper__btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; }
.stepper__btn:disabled { opacity: .35; cursor: default; }
/* fixed width: "95 g" -> "100 g" does not make the buttons on either side move. */
.stepper__val { min-width: 5ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; }
</style>
