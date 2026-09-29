import { ref } from 'vue'

const LATENCY_TIMEOUT_MS = 10000

export const getLatencyFromFetchAPI = async (url: string) => {
  const startTime = performance.now()

  try {
    const response = await fetch(`${url}?_=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(LATENCY_TIMEOUT_MS),
    })

    if (!response.ok) return 0
    return performance.now() - startTime
  } catch {
    return 0
  }
}

export const getChatGPTLatencyAPI = () => {
  return getLatencyFromFetchAPI('https://chatgpt.com/cdn-cgi/trace')
}

export const getClaudeLatencyAPI = () => {
  return getLatencyFromFetchAPI('https://api.anthropic.com/cdn-cgi/trace')
}

export const chatgptLatency = ref<number[]>([])
export const claudeLatency = ref<number[]>([])

export const forkLatencyTargets = [
  { name: 'ChatGPT', ref: chatgptLatency, api: getChatGPTLatencyAPI },
  { name: 'Claude', ref: claudeLatency, api: getClaudeLatencyAPI },
]
