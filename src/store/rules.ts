import { partitionRules } from '@/assembly/rule-category'
import { ruleProviderList, rules } from '@/assembly/rules'
import { RULE_TAB_TYPE } from '@/constant'
import { toSearchRegex } from '@/helper/search'
import { computed, ref, watch } from 'vue'
import { activeBackend } from './setup'

export const rulesFilter = ref('')
export const rulesTabShow = ref(RULE_TAB_TYPE.RULES)

watch(activeBackend, (backend) => {
  if (backend) rulesTabShow.value = RULE_TAB_TYPE.RULES
})

export const categorizedRules = computed(() => partitionRules(rules.value))
export const hasDnsRules = computed(() => categorizedRules.value.dns.length > 0)
export const selectedRules = computed(() =>
  rulesTabShow.value === RULE_TAB_TYPE.DNS
    ? categorizedRules.value.dns
    : categorizedRules.value.route,
)

export const ruleDisplayIndex = computed(
  () => new Map(selectedRules.value.map((rule, index) => [rule, index + 1])),
)

watch([hasDnsRules, rulesTabShow], ([hasDns]) => {
  if (!hasDns && rulesTabShow.value === RULE_TAB_TYPE.DNS) {
    rulesTabShow.value = RULE_TAB_TYPE.RULES
  }
})

export const renderRules = computed(() => {
  const searchRegex = toSearchRegex(rulesFilter.value)

  if (!searchRegex) {
    return selectedRules.value
  }

  return selectedRules.value.filter((rule) => {
    return searchRegex.testAny([rule.type, rule.payload, rule.proxy])
  })
})

export const renderRulesProvider = computed(() => {
  const searchRegex = toSearchRegex(rulesFilter.value)

  if (!searchRegex) {
    return ruleProviderList.value
  }

  return ruleProviderList.value.filter((ruleProvider) => {
    return searchRegex.testAny([ruleProvider.name, ruleProvider.behavior, ruleProvider.vehicleType])
  })
})
