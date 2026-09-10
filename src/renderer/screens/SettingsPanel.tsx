import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Chip, ColorSwatchPicker, Description, Label, ListBox, Select, Surface, TextArea, TextField, toast } from '@heroui/react';
import { RadioButtonGroup } from '@heroui-pro/react';
import { RiAttachment2 } from '@remixicon/react';
import jsQR from 'jsqr';
import { assemblePairingQrChunkPayload, parsePairingQrFrame, resolvePairingPayload, type PairingQrChunk, type ParsedPairing } from '@todex/protocol/transportCrypto';
import { BACKEND_LABEL_COLORS, backendLabelColor } from '../session/backendColors';
import { Field } from '../components/Field';
import { DevicePairingPanel } from '../components/DevicePairingPanel';
import { pairingConnectionPatch } from '../session/pairingImport';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel, healthLabelOf, settingsFromProfile } from '../session/helpers';

type Props = {
  session: TodeXSession;
};

async function decodeQrFromFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(image.data, image.width, image.height);
  return result?.data ?? null;
}

export function SettingsPanel({ session }: Props) {
  const { settings, setSettings, backendConnections, activeBackendConnectionId, setActiveBackendConnectionId, updateBackendConnection, addBackendConnection, removeBackendConnection, connectionState, connectionHealth, serverVersion, connect, closeSocket } = session;
  const [pairingText, setPairingText] = useState('');
  const [chunks, setChunks] = useState<Map<number, PairingQrChunk>>(new Map());
  const connected = connectionState === 'open' || connectionState === 'connecting';
  const activeProfile = backendConnections.find((item) => item.id === activeBackendConnectionId);
  const latestSession = useRef(session);
  latestSession.current = session;
  const pairingGeneration = useRef(0);
  useLayoutEffect(() => {
    setChunks(new Map());
    return () => { pairingGeneration.current += 1; };
  }, [activeProfile?.id, activeProfile?.serverUrl, settings.serverUrl]);


  const selectBackend = (id: string) => {
    const profile = backendConnections.find((item) => item.id === id);
    if (!profile) return;
    setActiveBackendConnectionId(profile.id);
    setSettings((current) => settingsFromProfile(profile, current));
  };

  const applyRawPairing = async (raw: string) => {
    if (!activeProfile) return;
    const sourceId = activeProfile.id;
    const sourceUrl = activeProfile.serverUrl;
    const sourceSettingsUrl = settings.serverUrl;
    const generation = ++pairingGeneration.current;
    const applyResolvedPairing = (pairing: ParsedPairing) => {
      const current = latestSession.current;
      const target = current.backendConnections.find(item => item.id === sourceId);
      if (generation !== pairingGeneration.current || current.activeBackendConnectionId !== sourceId
        || target?.serverUrl !== sourceUrl || current.settings.serverUrl !== sourceSettingsUrl) return;
      const patch = pairingConnectionPatch(target, pairing);
      current.updateBackendConnection(sourceId, patch);
      current.setSettings(value => value.serverUrl === sourceSettingsUrl
        && latestSession.current.activeBackendConnectionId === sourceId ? { ...value, ...patch } : value);
      setChunks(new Map());
      toast.success('配对信息已导入');
    };
    try {
      const frame = parsePairingQrFrame(raw);
      if (frame.kind === 'chunk') {
        const next = new Map(chunks);
        next.set(frame.chunk.index, frame.chunk);
        setChunks(next);
        if (next.size < frame.chunk.total) {
          toast(`已收到分片 ${next.size}/${frame.chunk.total}`);
          return;
        }
        const assembled = assemblePairingQrChunkPayload([...next.values()]);
        const pairing = await resolvePairingPayload(assembled);
        applyResolvedPairing(pairing);
        return;
      }
      const pairing = await resolvePairingPayload(frame.raw);
      applyResolvedPairing(pairing);
    } catch (error) {
      if (generation !== pairingGeneration.current) return;
      toast.danger(error instanceof Error ? error.message : '配对失败');
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">连接</h2>
        <p className="text-muted mt-1 text-sm">{healthLabelOf(connectionHealth)} · {connectionStateLabel(connectionState)}</p>
        {serverVersion ? (
          <Chip className="mt-2" variant="soft">{serverVersion.name} {serverVersion.version}{settings.tenantId ? ` · ${settings.tenantId}` : ''}</Chip>
        ) : null}
      </div>
      <Surface className="flex flex-col gap-4 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">后端连接</h3>
          <Button size="sm" variant="secondary" onPress={() => addBackendConnection()}>添加后端</Button>
        </div>
        <RadioButtonGroup
          className={backendConnections.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}
          layout="grid"
          name="backend-connection"
          value={activeBackendConnectionId}
          variant="secondary"
          onChange={selectBackend}
        >
          <Label className="col-span-full">当前后端</Label>
          {backendConnections.map((profile) => (
            <RadioButtonGroup.Item key={profile.id} value={profile.id}>
              <RadioButtonGroup.Indicator />
              <RadioButtonGroup.ItemContent>
                <Label className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: backendLabelColor(profile) }} />{profile.name}</Label>
                <Description className="truncate">{profile.tenantId ? `${profile.serverUrl} · ${profile.tenantId}` : profile.serverUrl}</Description>
              </RadioButtonGroup.ItemContent>
            </RadioButtonGroup.Item>
          ))}
        </RadioButtonGroup>
        {activeProfile ? (
          <>
            <Field label="名称" value={activeProfile.name} onChange={(name) => updateBackendConnection(activeProfile.id, { name })} />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">标签颜色</span>
              <ColorSwatchPicker
                aria-label="后端标签颜色"
                value={backendLabelColor(activeProfile)}
                onChange={(color) => updateBackendConnection(activeProfile.id, { labelColor: color.toString('hex') })}
              >
                {BACKEND_LABEL_COLORS.map(({ value, label }) => (
                  <ColorSwatchPicker.Item key={value} color={value} aria-label={label}>
                    <ColorSwatchPicker.Swatch />
                    <ColorSwatchPicker.Indicator />
                  </ColorSwatchPicker.Item>
                ))}
              </ColorSwatchPicker>
              <p className="text-muted text-xs">工作区旁的圆点使用此颜色，悬停可查看对应后端。颜色自动保存。</p>
            </div>
            <Field label="后端地址" value={activeProfile.serverUrl} onChange={(serverUrl) => { updateBackendConnection(activeProfile.id, { serverUrl }); setSettings((current) => ({ ...current, serverUrl })); }} />
            <Field label="Auth token" value={activeProfile.authToken} type="password" onChange={(authToken) => { updateBackendConnection(activeProfile.id, { authToken }); setSettings((current) => ({ ...current, authToken })); }} />
            <Field label="Tenant" value={activeProfile.tenantId} onChange={(tenantId) => { updateBackendConnection(activeProfile.id, { tenantId }); setSettings((current) => ({ ...current, tenantId })); }} />
            <Select selectedKey={activeProfile.encryptionProtocol} onSelectionChange={(key) => { if (typeof key === 'string') { const encryptionProtocol = key as typeof activeProfile.encryptionProtocol; updateBackendConnection(activeProfile.id, { encryptionProtocol }); setSettings((current) => ({ ...current, encryptionProtocol })); } }}>
              <Label>传输加密</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox><ListBox.Item id="none" textValue="none">none</ListBox.Item><ListBox.Item id="x25519" textValue="x25519">x25519</ListBox.Item><ListBox.Item id="ml-kem-768" textValue="ml-kem-768">ml-kem-768</ListBox.Item></ListBox></Select.Popover>
            </Select>
            {activeProfile.encryptionProtocol !== 'none' ? <Field label="加密公钥" value={activeProfile.encryptionPublicKey} onChange={(encryptionPublicKey) => { updateBackendConnection(activeProfile.id, { encryptionPublicKey }); setSettings((current) => ({ ...current, encryptionPublicKey })); }} /> : null}
            <DevicePairingPanel session={session} deviceName="TodeX Desktop" />
            <div className="flex gap-2"><Button onPress={() => (connected ? closeSocket(true) : connect())}>{connected ? '断开' : connectionState === 'error' ? '重试' : '连接'}</Button>{backendConnections.length > 1 ? <Button variant="danger-soft" onPress={() => removeBackendConnection(activeProfile.id)}>删除后端</Button> : null}</div>
          </>
        ) : null}
      </Surface>
      <Surface className="flex flex-col gap-4 rounded-2xl p-5">
        <h3 className="font-semibold">右侧面板</h3>
        <Select
          value={session.workbenchSharing}
          isDisabled={!session.workbenchSharingHydrated}
          onChange={(value) => {
            if (value === 'conversation' || value === 'workspace') session.setWorkbenchSharing(value);
          }}
        >
          <Label>面板共享方式</Label>
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="conversation" textValue="每个对话独立">
                每个对话独立
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="workspace" textValue="同一工作区共享">
                同一工作区共享
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
          <Description>
            {session.workbenchSharing === 'workspace'
              ? '同一工作区的对话复用终端、浏览器和文件标签，以及面板展开状态。'
              : '默认每个对话独立保存面板。新对话的面板为空，并保持收起。'}
          </Description>
        </Select>
      </Surface>
      <Surface className="flex flex-col gap-4 rounded-2xl p-5">
        <h3 className="font-semibold">配对</h3>
        <p className="text-muted text-sm">粘贴后端 TUI 配对 JSON，或把二维码图片拖到这里。</p>
        <TextField className="w-full" value={pairingText} onChange={setPairingText}>
          <Label>配对内容</Label>
          <TextArea className="w-full" rows={4} />
        </TextField>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onPress={() => {
              if (pairingText.trim()) {
                void applyRawPairing(pairingText.trim());
              }
            }}
          >
            导入粘贴内容
          </Button>
          <Button
            variant="tertiary"
            onPress={async () => {
              const text = (await navigator.clipboard.readText()).trim();
              if (text) {
                setPairingText(text);
                void applyRawPairing(text);
              }
            }}
          >
            从剪贴板导入
          </Button>
        </div>
        <label
          className="border-separator text-muted flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-8 text-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={async (event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!file) return;
            const decoded = await decodeQrFromFile(file);
            if (!decoded) {
              toast.danger('无法从图片解码二维码');
              return;
            }
            void applyRawPairing(decoded);
          }}
        >
          <RiAttachment2 className="mb-2 size-5" />
          拖入二维码图片
          <input
            className="hidden"
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const decoded = await decodeQrFromFile(file);
              if (!decoded) {
                toast.danger('无法从图片解码二维码');
                return;
              }
              void applyRawPairing(decoded);
            }}
          />
        </label>
      </Surface>
    </div>
  );
}
