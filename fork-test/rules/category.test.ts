import { partitionRules } from '@/assembly/rule-category'
import type { Rule } from '@/types'
import { expect, it } from 'vitest'

it('separates DNS rules, retains legacy routing rules and ignores unknown categories', () => {
  const rules = [undefined, 'route', 'dns', 'other', '', null].map(
    (category, index) => ({ category, payload: String(index) }) as unknown as Rule,
  )
  const result = partitionRules(rules)
  expect(result.route).toEqual(rules.slice(0, 2))
  expect(result.dns).toEqual([rules[2]])
  expect(partitionRules([])).toEqual({ route: [], dns: [] })
})

it('keeps categories while switching tabs and searching, then falls back when DNS disappears', async () => {
  const { rules } = await import('@/assembly/rules')
  const { categorizedRules, hasDnsRules, renderRules, rulesFilter, rulesTabShow } =
    await import('@/store/rules')
  const { RULE_TAB_TYPE } = await import('@/constant')
  const { nextTick } = await import('vue')
  rules.value = [
    { category: 'dns', payload: 'example.com', type: 'default', proxy: 'dns-local' },
    { category: 'route', payload: 'example.com', type: 'default', proxy: 'direct' },
    { payload: 'legacy', type: 'default', proxy: 'direct' },
    { category: 'other', payload: 'hidden', type: 'default', proxy: 'direct' },
  ] as Rule[]
  rulesTabShow.value = RULE_TAB_TYPE.RULES
  rulesFilter.value = ''
  expect(renderRules.value).toEqual(categorizedRules.value.route)
  expect(renderRules.value).toHaveLength(2)
  rulesTabShow.value = RULE_TAB_TYPE.DNS
  expect(renderRules.value).toHaveLength(1)
  rulesFilter.value = 'missing'
  expect(renderRules.value).toHaveLength(0)
  expect(hasDnsRules.value).toBe(true)
  rules.value = []
  await nextTick()
  expect(rulesTabShow.value).toBe(RULE_TAB_TYPE.RULES)
  expect(hasDnsRules.value).toBe(false)
  rulesFilter.value = ''
})

it('orders DNS before routing and providers, and numbers each category independently of search', async () => {
  const { RULE_TAB_TYPE } = await import('@/constant')
  const { rules } = await import('@/assembly/rules')
  const { selectedRules, ruleDisplayIndex, rulesTabShow, rulesFilter } =
    await import('@/store/rules')
  expect(Object.values(RULE_TAB_TYPE).slice(0, 3)).toEqual([
    RULE_TAB_TYPE.DNS,
    RULE_TAB_TYPE.RULES,
    RULE_TAB_TYPE.PROVIDER,
  ])
  rules.value = [
    { category: 'dns', payload: 'dns', index: 0 },
    { category: 'route', payload: 'first', index: 1 },
    { category: 'route', payload: 'second', index: 2 },
  ] as Rule[]
  rulesTabShow.value = RULE_TAB_TYPE.RULES
  expect(ruleDisplayIndex.value.get(selectedRules.value[0]!)).toBe(1)
  expect(ruleDisplayIndex.value.get(selectedRules.value[1]!)).toBe(2)
  rulesFilter.value = 'second'
  expect(ruleDisplayIndex.value.get(selectedRules.value[1]!)).toBe(2)
  expect(selectedRules.value[0]!.index).toBe(1)
  rulesTabShow.value = RULE_TAB_TYPE.DNS
  expect(ruleDisplayIndex.value.get(selectedRules.value[0]!)).toBe(1)
  rulesFilter.value = ''
  rules.value = []
})
