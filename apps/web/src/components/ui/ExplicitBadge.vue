<script setup lang="ts">
// The "E" of catalogs: a track flagged explicit by the service that launched it. Same square
// everywhere (bottom player, Listening panel, device detail) — the search rows, for their part,
// have always carried their own copy of this style.
</script>

<template>
  <span class="explicit" :title="$t('ytmusic.explicit')" :aria-label="$t('ytmusic.explicit')">E</span>
</template>

<style scoped>
.explicit {
  flex: 0 0 auto; display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 3px; border: 1px solid var(--muted); font-size: 10px; font-weight: 700; line-height: 1; color: var(--muted);
}
</style>
