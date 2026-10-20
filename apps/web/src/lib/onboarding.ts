// The guide that follows the creation of a property: creation reloads the application on the new
// house, so we must remember where we are — draw the terrain, then set up the first room.
// Comfort of THIS machine only (browser storage): without it, the house is created anyway,
// we are simply not guided.

export type OnboardingStep = 'terrain' | 'room'
export interface Onboarding { propertyId: string; step: OnboardingStep }

const KEY = 'kasbah.onboarding'

export function readOnboarding(): Onboarding | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Onboarding> | null
    return v && typeof v.propertyId === 'string' && (v.step === 'terrain' || v.step === 'room') ? { propertyId: v.propertyId, step: v.step } : null
  } catch { return null }
}

export function writeOnboarding(o: Onboarding | null): void {
  try {
    if (o) localStorage.setItem(KEY, JSON.stringify(o))
    else localStorage.removeItem(KEY)
  } catch { /* storage unavailable: no guide */ }
}
