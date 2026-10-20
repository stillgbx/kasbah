// Render layers (three `Object3D.layers`). Two, so that ambient OCCLUSION sees the scene
// differently from the render: `ArchitectureGTAOPass` (`core/post.ts`) turns them off while it
// captures depth and normals. A halo is an additive sprite, with no volume; seen by that capture, it
// became a solid panel facing the camera, hence an obstacle, hence a BLACK square under every lit
// lamp. Everything translucent or additive, laid on the scene without being its matter, lives there.
//
// `DECOR_LAYER` — the decorations of a LEVEL's devices (a lamp's halo, a player's wave, the gauges
// of a cabinet or a module, cover art on a screen, the "move" mode guide) and those of EDIT
// mode (opening handles, dimension lines, origin marker, parking space markings). The raycaster
// opens this layer: that is what makes a handle touchable.
//
// `SITE_DECOR_LAYER` — the same decorations, but those of the GARDEN, which the raycaster does not see.
//
// Until 2026-09-24 the scene rendered in PASSES (a global one, then one per lit level) and
// a third layer, `LAMP_LAYER`, kept indoor lamps out of the global pass. A
// single pass today: the lamp is confined to its level by the shader (`core/levelLight.ts`).
export const DECOR_LAYER = 1
export const SITE_DECOR_LAYER = 3
