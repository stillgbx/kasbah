<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PageHeader from '../components/layout/PageHeader.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { navItemOf } from '../lib/navItems'
import { useSessionStore } from '../stores/session'

// A view the account may not use, opened by its address (a bookmark, a link): said plainly, rather
// than an empty view whose requests the server refuses. The rail no longer leads there. Shown by
// `App.vue` in place of the view, which is never mounted.
const route = useRoute()
const session = useSessionStore()
const item = computed(() => navItemOf(route))
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__body">
      <div class="card card--soft noright">
        <StrokeIcon name="lock" :size="28" class="muted" />
        <p>{{ $t('noRight.title', { user: session.user ?? '', view: item ? $t(item.label) : '' }) }}</p>
        <p class="muted small">{{ $t('noRight.hint') }}</p>
        <router-link :to="{ name: 'home' }" class="pill">{{ $t('noRight.home') }}</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* as the agenda without a calendar: the card in the middle of the page */
.page { height: 100%; display: flex; flex-direction: column; }
.page__body { flex: 1 1 auto; min-height: 0; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); display: flex; flex-direction: column; }
.noright { margin: auto; max-width: 460px; padding: 28px; display: grid; justify-items: center; gap: 12px; text-align: center; }
.noright p { margin: 0; }
.small { font-size: 12px; }
</style>
