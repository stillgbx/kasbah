export interface HouseDefaults {
  levelHeight: number
  slabThickness: number
  interiorWallThickness: number
  exteriorWallThickness: number
  doorHeight: number
  windowSill: number
}

export const HOUSE_DEFAULTS: HouseDefaults = {
  levelHeight: 2.6,
  slabThickness: 0.25,
  interiorWallThickness: 0.10,
  exteriorWallThickness: 0.30,
  doorHeight: 2.10,
  windowSill: 0.9,
}

export function resolveDefaults(partial?: Partial<HouseDefaults>): HouseDefaults {
  const out: HouseDefaults = { ...HOUSE_DEFAULTS }
  if (partial) {
    for (const [k, v] of Object.entries(partial)) {
      if (v !== undefined) (out as unknown as Record<string, number>)[k] = v
    }
  }
  return out
}
