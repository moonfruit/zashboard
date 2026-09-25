import { CONNECTIONS_TABLE_ACCESSOR_KEY } from '@/constant'
import type { Connection } from '@/types'
import type { ColumnDef, Row } from '@tanstack/vue-table'
import type { VNode } from 'vue'
import type { JSX } from 'vue/jsx-runtime'

const KEYS = [
  CONNECTIONS_TABLE_ACCESSOR_KEY.Protocol,
  CONNECTIONS_TABLE_ACCESSOR_KEY.Inbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.FromOutbound,
  CONNECTIONS_TABLE_ACCESSOR_KEY.OutboundType,
] as const

type SingboxKey = (typeof KEYS)[number]

export const singboxColumns = (
  highlightedCell: (
    key: CONNECTIONS_TABLE_ACCESSOR_KEY,
  ) => (cell: { row: Row<Connection> }) => VNode,
  getTableDisplayValue: (connection: Connection, key: CONNECTIONS_TABLE_ACCESSOR_KEY) => unknown,
  t: (key: string) => string,
): ColumnDef<Connection>[] =>
  KEYS.map((key) => ({
    header: () => t(key),
    id: key,
    accessorFn: (original) => getTableDisplayValue(original, key),
    cell: highlightedCell(key),
  }))

export const singboxCardFields = (
  highlightedText: (key: CONNECTIONS_TABLE_ACCESSOR_KEY) => JSX.Element,
) =>
  Object.fromEntries(
    KEYS.map((key) => [key, () => <div class="whitespace-nowrap">{highlightedText(key)}</div>]),
  ) as Record<SingboxKey, () => JSX.Element>
