import { singboxApiDriver } from '@/assembly/driver/singbox-api'
import {
  ClashModeSchema,
  GroupsSchema,
  type ClashMode,
  type Groups,
} from '@/assembly/singbox/api/gen/daemon/started_service_pb'
import { createChangeDetector, groupsSignature } from '@/assembly/singbox/events'
import { create } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeShared, installRuntime } from './fake-runtime'

const groups = (selected: string, delay = 100) =>
  create(GroupsSchema, {
    group: [
      {
        tag: 'proxy',
        type: 'selector',
        selected,
        items: [{ tag: 'a', urlTestTime: 1n, urlTestDelay: delay }],
      },
    ],
  })

describe('change detection', () => {
  it('ignores the first value and repeats', () => {
    const changed = createChangeDetector((value: string) => value)

    expect(changed('a')).toBe(false)
    expect(changed('a')).toBe(false)
    expect(changed('b')).toBe(true)
  })

  it('signs selection and url test results', () => {
    expect(groupsSignature(groups('a'))).not.toBe(groupsSignature(groups('b')))
    expect(groupsSignature(groups('a', 100))).not.toBe(groupsSignature(groups('a', 200)))
    expect(groupsSignature(groups('a'))).toBe(groupsSignature(groups('a')))
  })
})

describe('singboxApiDriver.events', () => {
  const groupsStream = fakeShared<Groups>()
  const clashModeStream = fakeShared<ClashMode>()

  beforeEach(() => {
    installRuntime({ groupsStream, clashModeStream })
  })

  it('emits proxies.changed and configs.changed on real changes only', () => {
    const kinds: string[] = []
    const subscription = singboxApiDriver.events!.subscribe((kind) => kinds.push(kind))

    groupsStream.emit(groups('a'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'Rule' }))
    groupsStream.emit(groups('a'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'rule' }))
    expect(kinds).toEqual([])

    groupsStream.emit(groups('b'))
    clashModeStream.emit(create(ClashModeSchema, { mode: 'Global' }))
    expect(kinds).toEqual(['proxies.changed', 'configs.changed'])

    subscription.close()
    expect(groupsStream.size()).toBe(0)
    expect(clashModeStream.size()).toBe(0)
  })
})
