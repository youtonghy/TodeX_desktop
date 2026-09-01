import { Button, Card, Chip, toast } from '@heroui/react';
import { RiFileCopyLine, RiGithubLine, RiInformationLine, RiServerLine } from '@remixicon/react';
import packageInfo from '../../../package.json';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel } from '../session/helpers';

const PROJECT_URL = 'https://github.com/youtonghy/TodeX_desktop';

type Props = {
  session: TodeXSession;
};

function InfoRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-separator py-3 last:border-b-0">
      <dt className="text-muted shrink-0 text-sm">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-sm font-medium">
        <span className="truncate" title={value}>{value}</span>
        {copyable ? (
          <Button isIconOnly size="sm" variant="ghost" aria-label={`复制${label}`} onPress={() => void navigator.clipboard.writeText(value).then(() => toast.success('已复制'))}>
            <RiFileCopyLine className="size-4" />
          </Button>
        ) : null}
      </dd>
    </div>
  );
}

export function AboutPanel({ session }: Props) {
  const connected = session.connectionState === 'open';
  const backendVersion = session.serverVersion
    ? `${session.serverVersion.name} ${session.serverVersion.version}`
    : '未获取';

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-4">
        <div className="bg-accent flex size-12 shrink-0 items-center justify-center rounded-full text-accent-foreground">
          <RiInformationLine className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">TodeX Desktop</h2>
            <Chip size="sm" variant="soft">v{packageInfo.version}</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">统一连接 Codex、Pi、Claude Code 等 Agent 的桌面工作台。</p>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <RiServerLine className="text-muted size-4" />
          <h3 className="font-semibold">运行信息</h3>
          <Chip className="ml-auto" size="sm" color={connected ? 'success' : 'danger'} variant="soft">
            {connectionStateLabel(session.connectionState)}
          </Chip>
        </div>
        <dl>
          <InfoRow label="桌面版本" value={packageInfo.version} />
          <InfoRow label="后端版本" value={backendVersion} />
          <InfoRow label="后端地址" value={session.settings.serverUrl || '未配置'} copyable={Boolean(session.settings.serverUrl)} />
          <InfoRow label="工作区" value={session.activeWorkspace?.path || '未选择'} copyable={Boolean(session.activeWorkspace?.path)} />
          <InfoRow label="数据目录" value={session.serverVersion?.data_dir || '未获取'} copyable={Boolean(session.serverVersion?.data_dir)} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <RiGithubLine className="text-muted mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">项目地址</h3>
            <p className="text-muted mt-1 truncate text-sm" title={PROJECT_URL}>{PROJECT_URL}</p>
          </div>
          <Button size="sm" variant="secondary" onPress={() => void navigator.clipboard.writeText(PROJECT_URL).then(() => toast.success('项目地址已复制'))}>
            <RiFileCopyLine className="size-4" />
            复制
          </Button>
        </div>
      </Card>
    </div>
  );
}
