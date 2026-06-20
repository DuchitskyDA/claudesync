import type { McpServerDef } from './api'

export const MCP_SERVERS: McpServerDef[] = [
  {
    id: 'yandex-tracker',
    name: 'Yandex Tracker',
    description: 'Доступ к задачам, очередям и комментариям Яндекс Трекера из Claude Code.',
    docsUrl: 'https://github.com/apractice-ru/yandex-tracker-mcp',
    runtime: 'uv',
    command: 'uvx',
    packageSpec: 'yandex-tracker-mcp@latest',
    env: [
      { name: 'TRACKER_TOKEN', label: 'OAuth-токен (TRACKER_TOKEN)', secret: true, placeholder: 'y0__...' },
      { name: 'TRACKER_ORG_ID', label: 'ID организации (TRACKER_ORG_ID)', secret: false, placeholder: '1130000069615832' },
    ],
  },
]

export const pkgName = (spec: string): string => spec.split('@')[0] ?? spec
