import { ref } from 'vue'

export type SingboxVariant = 'official' | 'refind' | 'moonfruit'

export const detectSingboxVariant = (version: string): SingboxVariant => {
  if (/-moonfruit\b/i.test(version)) return 'moonfruit'
  if (/-ref1nd\b/i.test(version)) return 'refind'
  return 'official'
}

export const singboxVariant = ref<SingboxVariant>()
