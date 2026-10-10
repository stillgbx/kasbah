// Le guide qui suit la création d'une propriété : la création recharge l'application sur la maison
// neuve, il faut donc retenir où l'on en est — dessiner le terrain, puis régler la première pièce.
// Confort de CE poste seulement (stockage du navigateur) : sans lui, la maison est créée quand même,
// on n'est simplement pas guidé.

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
  } catch { /* stockage indisponible : pas de guide */ }
}
