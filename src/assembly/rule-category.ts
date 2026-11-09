import type { Rule } from '@/types'

export const partitionRules = (rules: Rule[]) => ({
  route: rules.filter((rule) => rule.category === undefined || rule.category === 'route'),
  dns: rules.filter((rule) => rule.category === 'dns'),
})
