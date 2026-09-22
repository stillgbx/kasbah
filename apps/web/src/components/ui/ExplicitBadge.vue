<script setup lang="ts">
// Le « E » des catalogues : un morceau signalé explicit par le service qui l'a lancé. Même carré
// partout (lecteur du bas, panneau Écoute, détail d'un appareil) — les lignes de recherche, elles,
// portent depuis toujours leur propre copie de ce style.
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
