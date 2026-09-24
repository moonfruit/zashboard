export const getSingboxLogType = (payload: string) => {
  const start = payload.startsWith('[') ? payload.indexOf(']') + 2 : 0
  const end = payload.indexOf(': ', start)

  return end === -1 ? '' : payload.slice(start, end + 1)
}

export const getLogConnectionID = (payload: string) =>
  payload.match(/^\[(\d+)\s[^\]]*\]/)?.[1] ?? null
