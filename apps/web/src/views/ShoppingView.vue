<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { shoppingKey, SHOPPING_NAME_MAX, SHOPPING_QUANTITY_MAX, type ShoppingItem } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useShoppingStore } from '../stores/shopping'

// The house's shared shopping list. A single page, three zones:
// - a field that serves BOTH to search and to add: you type, the known products offer themselves
//   over the page (nothing shifts underneath), Enter adds what is typed;
// - the list, in order of addition. Ticking STRIKES the row in place: nothing moves under the
//   finger at the store, and "Finish shopping" removes the ticked ones at once;
// - the usuals (starred products), in fixed order: one touch puts them back in the list.
// Cut in Settings → Plugins, the page says so and points to Settings (the rail no longer shows it).
// A row's counter keeps its place: at 1, its "−" becomes a trash can in the same spot.
const store = useShoppingStore()
onMounted(() => { if (store.enabled && !store.list.products.length && !store.items.length) void store.load() })

const query = ref('')
const field = ref<HTMLInputElement | null>(null)
const focused = ref(false)
const suggestions = computed(() => store.suggest(query.value))
/** The input matches no known product: the first suggestion is to add it as typed. */
const isNew = computed(() => {
  const key = shoppingKey(query.value)
  return key !== '' && !suggestions.value.some((p) => p.id === key)
})
const open = computed(() => focused.value && shoppingKey(query.value) !== '')

function addName(name: string) {
  void store.add(name)
  query.value = ''
  field.value?.focus()
}
function submit() {
  const key = shoppingKey(query.value)
  if (!key) return
  // a known product keeps its name (its case, its accents), not the one just typed
  addName(suggestions.value.find((p) => p.id === key)?.name ?? query.value)
}

const toggle = (item: ShoppingItem) => store.update(item.id, { checked: !item.checked })
function less(item: ShoppingItem) {
  if (item.quantity <= 1) void store.remove(item.id)
  else void store.update(item.id, { quantity: item.quantity - 1 })
}
const more = (item: ShoppingItem) => store.update(item.id, { quantity: Math.min(SHOPPING_QUANTITY_MAX, item.quantity + 1) })
const star = (name: string) => store.setFavorite(name, !store.isFavorite(name))

const toBuy = computed(() => store.items.length - store.checkedCount)
</script>

<template>
  <div class="page">
    <PageHeader>
      <div v-if="store.enabled" class="head">
        <span class="muted head__count">{{ $t('shopping.count', { left: toBuy, checked: store.checkedCount }) }}</span>
        <!-- always there, off with no ticked row: the button does not pop up at the first tick -->
        <button type="button" class="pill" data-on="1" :disabled="store.checkedCount === 0" @click="store.finish()">
          <StrokeIcon name="checkCircle" :size="16" /><span>{{ $t('shopping.finish') }}</span>
        </button>
      </div>
    </PageHeader>

    <!-- turned off in Settings while looking at it (or address typed): the rail no longer offers it -->
    <div v-if="!store.enabled" class="body body--off">
      <div class="card card--soft off">
        <StrokeIcon name="cart" :size="28" class="muted" />
        <p class="muted">{{ $t('shopping.disabled') }}</p>
        <router-link :to="{ name: 'settings' }" class="pill">{{ $t('shopping.openSettings') }}</router-link>
      </div>
    </div>
    <template v-else>
      <div class="tools">
        <div class="search" :data-open="open ? '1' : '0'">
          <StrokeIcon name="plus" :size="18" class="search__icon" />
          <input ref="field" v-model="query" type="search" class="search__input" enterkeyhint="done" autocomplete="off" :maxlength="SHOPPING_NAME_MAX"
                 :placeholder="$t('shopping.placeholder')" :aria-label="$t('shopping.placeholder')"
                 @focus="focused = true" @blur="focused = false" @keydown.enter.prevent="submit" @keydown.esc="query = ''">
          <button type="button" class="search__clear" :class="{ 'is-hidden': !query }" :aria-label="$t('shopping.clear')" @mousedown.prevent @click="query = ''">
            <StrokeIcon name="close" :size="14" />
          </button>
          <!-- over the page: the list underneath does not shift while typing.
               `mousedown.prevent` keeps focus in the field, we chain additions from the keyboard. -->
          <div v-if="open" class="card suggest" role="listbox">
            <button v-if="isNew" type="button" class="suggest__row" @mousedown.prevent @click="addName(query)">
              <StrokeIcon name="plus" :size="16" class="suggest__lead" />
              <span class="suggest__name">{{ $t('shopping.addNew', { name: query.trim() }) }}</span>
            </button>
            <div v-for="p in suggestions" :key="p.id" class="suggest__line">
              <button type="button" class="suggest__row" @mousedown.prevent @click="addName(p.name)">
                <StrokeIcon :name="store.isToBuy(p.name) ? 'check' : 'plus'" :size="16" class="suggest__lead" />
                <span class="suggest__name">{{ p.name }}</span>
                <span class="muted suggest__tag" :class="{ 'is-hidden': !store.isToBuy(p.name) }">{{ $t('shopping.inList') }}</span>
              </button>
              <button type="button" class="star" :data-on="p.favorite ? '1' : '0'" :aria-pressed="p.favorite"
                      :aria-label="p.favorite ? $t('shopping.unstar', { name: p.name }) : $t('shopping.star', { name: p.name })"
                      :title="p.favorite ? $t('shopping.unstar', { name: p.name }) : $t('shopping.star', { name: p.name })"
                      @mousedown.prevent @click="star(p.name)">
                <StrokeIcon name="star" :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="body">
        <section class="list" :aria-label="$t('shopping.list')">
          <div v-if="!store.items.length" class="card card--soft empty muted">{{ $t('shopping.empty') }}</div>
          <div v-for="item in store.items" :key="item.id" class="card row" :data-checked="item.checked ? '1' : '0'">
            <button type="button" class="row__main" role="checkbox" :aria-checked="item.checked" @click="toggle(item)">
              <span class="row__box"><StrokeIcon name="check" :size="16" :stroke-width="2.4" /></span>
              <MarqueeText class="row__name" :text="item.name" />
            </button>
            <button type="button" class="star" :data-on="store.isFavorite(item.name) ? '1' : '0'" :aria-pressed="store.isFavorite(item.name)"
                    :aria-label="store.isFavorite(item.name) ? $t('shopping.unstar', { name: item.name }) : $t('shopping.star', { name: item.name })"
                    :title="store.isFavorite(item.name) ? $t('shopping.unstar', { name: item.name }) : $t('shopping.star', { name: item.name })"
                    @click="star(item.name)">
              <StrokeIcon name="star" :size="16" />
            </button>
            <!-- put away (not removed) when the row is ticked: the row keeps its width -->
            <div class="step" :class="{ 'is-hidden': item.checked }">
              <button type="button" class="step__btn" :aria-label="item.quantity <= 1 ? $t('shopping.remove', { name: item.name }) : $t('shopping.less', { name: item.name })"
                      :title="item.quantity <= 1 ? $t('shopping.remove', { name: item.name }) : $t('shopping.less', { name: item.name })" @click="less(item)">
                <StrokeIcon :name="item.quantity <= 1 ? 'trash' : 'minus'" :size="16" />
              </button>
              <span class="step__qty" :aria-label="$t('shopping.quantity', { qty: item.quantity })">{{ item.quantity }}</span>
              <button type="button" class="step__btn" :disabled="item.quantity >= SHOPPING_QUANTITY_MAX" :aria-label="$t('shopping.more', { name: item.name })"
                      :title="$t('shopping.more', { name: item.name })" @click="more(item)">
                <StrokeIcon name="plus" :size="16" />
              </button>
            </div>
          </div>
        </section>

        <section class="favs" :aria-label="$t('shopping.favorites')">
          <div class="section-label favs__title">{{ $t('shopping.favorites') }}</div>
          <!-- the help fits in the tile strip, at the same height: the first star does not shift the list -->
          <div class="favs__chips">
            <p v-if="!store.favorites.length" class="muted favs__hint">{{ $t('shopping.noFavorites') }}</p>
            <button v-for="p in store.favorites" :key="p.id" type="button" class="chip" :data-on="store.isToBuy(p.name) ? '1' : '0'"
                    :disabled="store.isToBuy(p.name)" :title="store.isToBuy(p.name) ? $t('shopping.inList') : $t('shopping.addOne', { name: p.name })"
                    @click="addName(p.name)">
              <StrokeIcon :name="store.isToBuy(p.name) ? 'check' : 'plus'" :size="14" />
              <span>{{ p.name }}</span>
            </button>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; }
.head { display: flex; align-items: center; gap: 14px; }
.head .pill { flex: 0 0 auto; white-space: nowrap; }
.head__count { font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }

.tools { padding: 0 var(--page-x) 12px; flex: 0 0 auto; }
.search {
  position: relative; max-width: 720px; display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 16px;
  border-radius: 999px; border: 1px solid var(--line); background: var(--surface);
}
.search:focus-within { border-color: var(--accent); }
.search__icon { color: var(--muted); flex: 0 0 auto; }
.search__input { flex: 1 1 0; min-width: 0; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 16px; outline: none; }
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--muted); flex: 0 0 auto; }
.search__clear:hover { background: var(--surface2); color: var(--text); }
.is-hidden { visibility: hidden; }

.suggest {
  position: absolute; z-index: 10; top: calc(100% + 6px); left: 0; right: 0; padding: 6px; box-shadow: var(--shadow);
  display: grid; gap: 2px; max-height: min(60vh, 420px); overflow-y: auto;
}
.suggest__line { display: flex; align-items: center; gap: 4px; }
.suggest__row {
  flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 10px;
  border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text); font: inherit; font-size: 15px; text-align: left;
}
.suggest__row:hover { background: var(--surface2); }
.suggest__lead { color: var(--accent); flex: 0 0 auto; }
.suggest__name { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suggest__tag { flex: 0 0 auto; font-size: 12px; }

/* List and usuals side by side: a touched usual adds a row WITHOUT moving the tiles. */
.body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px);
  display: grid; grid-template-columns: minmax(0, 720px) minmax(220px, 320px); gap: 24px; align-content: start; align-items: start;
}
.body--off { display: flex; }
.off { margin: auto; max-width: 460px; padding: 28px; display: grid; justify-items: center; gap: 12px; text-align: center; }
.off p { margin: 0; }
.list { display: grid; gap: 8px; }
.empty { padding: 24px; text-align: center; }

.row { display: flex; align-items: center; gap: 4px; height: 60px; padding: 0 8px 0 0; box-sizing: border-box; }
.row__main {
  flex: 1 1 0; min-width: 0; height: 100%; display: flex; align-items: center; gap: 14px; padding: 0 0 0 14px;
  border: 0; background: transparent; color: var(--text); font: inherit; text-align: left;
}
.row__box {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 8px; border: 2px solid var(--line); display: grid; place-items: center;
  color: transparent; transition: background .15s, border-color .15s, color .15s;
}
.row__name { flex: 1 1 0; min-width: 0; font-size: 16px; font-weight: 500; transition: opacity .15s; }
.row[data-checked='1'] .row__box { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.row[data-checked='1'] .row__name { text-decoration: line-through; opacity: .5; }

.star { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border: 0; border-radius: 999px; background: transparent; color: color-mix(in srgb, var(--muted) 55%, transparent); }
.star:hover { color: var(--text); background: var(--surface2); }
.star[data-on='1'] { color: var(--accent); }
.star[data-on='1'] svg { fill: currentColor; }

.step { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px; background: var(--surface2); }
.step__btn { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--text); }
.step__btn:hover:not(:disabled) { background: var(--surface); }
.step__btn:disabled { opacity: .35; cursor: default; }
.step__qty { width: 3ch; text-align: center; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }

.favs { display: grid; gap: 10px; align-content: start; }
.favs__title { padding-top: 4px; }
.favs__hint { margin: 0; font-size: 13px; min-height: 40px; display: flex; align-items: center; }
.favs__chips { display: flex; flex-wrap: wrap; gap: 8px; min-height: 40px; }
.chip {
  height: 40px; padding: 0 14px 0 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text);
  display: inline-flex; align-items: center; gap: 6px; font: 500 14px/1 var(--font); max-width: 100%;
}
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover:not(:disabled) { background: var(--surface2); }
.chip svg { color: var(--accent); flex: 0 0 auto; }
/* already to buy: dimmed, same size (only the icon changes) */
.chip[data-on='1'] { opacity: .45; cursor: default; }

/* Narrow screen: the usuals go ABOVE the list, on a strip that scrolls sideways and
   keeps its height — an added row lengthens the list downward, the tiles do not move. */
@media (max-width: 899px) {
  .body { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .favs { order: -1; gap: 6px; }
  .favs__chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 calc(-1 * var(--page-x)); padding: 0 var(--page-x); }
  .favs__chips::-webkit-scrollbar { display: none; }
  .chip { flex: 0 0 auto; }
}
@media (max-width: 600px) {
  .head__count { display: none; }
}
</style>
