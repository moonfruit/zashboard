import type { Groups } from './api/gen/daemon/started_service_pb'

export const groupsSignature = (groups: Groups) =>
  groups.group
    .map(
      (group) =>
        `${group.tag}=${group.selected}[${group.items
          .map((item) => `${item.tag}/${item.urlTestTime}/${item.urlTestDelay}`)
          .join(',')}]`,
    )
    .join(';')

export const createChangeDetector = <T>(signature: (value: T) => string) => {
  let last: string | undefined

  return (value: T) => {
    const next = signature(value)
    const changed = last !== undefined && last !== next

    last = next
    return changed
  }
}
