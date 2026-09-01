import { useState } from 'react';
import { Button, Chip, Description, Label, ListBox, Select, Surface, TextArea, TextField, toast } from '@heroui/react';
import { RadioButtonGroup } from '@heroui-pro/react';
import { RiAttachment2 } from '@remixicon/react';
import jsQR from 'jsqr';
import { applyPairingToSettings, assemblePairingQrChunkPayload, parsePairingQrFrame, resolvePairingPayload, type PairingQrChunk } from '@todex/protocol/transportCrypto';
import { Field } from '../components/Field';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel, healthLabelOf, settingsFromProfile } from '../session/helpers';
import { connectionFailureLabel } from '@todex/protocol/connectionError';

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
  const { settings, setSettings, backendConnections, activeBackendConnectionId, setActiveBackendConnectionId, updateBackendConnection, addBackendConnection, removeBackendConnection, connectionState, connectionHealth, serverVersion, lastError, connect, closeSocket } = session;
  const [pairingText, setPairingText] = useState('');
  const [chunks, setChunks] = useState<Map<number, PairingQrChunk>>(new Map());
  const connected = connectionState === 'open' || connectionState === 'connecting';
  const classified = connectionFailureLabel(connectionHealth.code);
  const activeProfile = backendConnections.find((item) => item.id === activeBackendConnectionId);

  const selectBackend = (id: string) => {
    const profile = backendConnections.find((item) => item.id === id);
    if (!profile) return;
    setActiveBackendConnectionId(profile.id);
    setSettings((current) => settingsFromProfile(profile, current));
  };

  const applyRawPairing = async (raw: string) => {
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
        setSettings((current) => applyPairingToSettings(current, pairing));
        setChunks(new Map());
        toast.success('配对信息已导入');
        return;
      }
      const pairing = await resolvePairingPayload(frame.raw);
      setSettings((current) => applyPairingToSettings(current, pairing));
      toast.success('配对信息已导入');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '配对失败');
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">连接</h2>
        <p className="text-muted mt-1 text-sm">{healthLabelOf(connectionHealth)} · {connectionStateLabel(connectionState)}</p>
        {classified ? <p className="text-danger mt-1 text-sm">{classified}</p> : null}
        {lastError && lastError !== connectionHealth.error ? <p className="text-danger mt-1 text-sm">{lastError}</p> : null}
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
                <Label>{profile.name}</Label>
                <Description className="truncate">{profile.tenantId ? `${profile.serverUrl} · ${profile.tenantId}` : profile.serverUrl}</Description>
              </RadioButtonGroup.ItemContent>
            </RadioButtonGroup.Item>
          ))}
        </RadioButtonGroup>
        {activeProfile ? (
          <>
            <Field label="名称" value={activeProfile.name} onChange={(name) => updateBackendConnection(activeProfile.id, { name })} />
            <Field label="后端地址" value={activeProfile.serverUrl} onChange={(serverUrl) => { updateBackendConnection(activeProfile.id, { serverUrl }); setSettings((current) => ({ ...current, serverUrl })); }} />
            <Field label="Auth token" value={activeProfile.authToken} type="password" onChange={(authToken) => { updateBackendConnection(activeProfile.id, { authToken }); setSettings((current) => ({ ...current, authToken })); }} />
            <Field label="Tenant" value={activeProfile.tenantId} onChange={(tenantId) => { updateBackendConnection(activeProfile.id, { tenantId }); setSettings((current) => ({ ...current, tenantId })); }} />
            <Select selectedKey={activeProfile.encryptionProtocol} onSelectionChange={(key) => { if (typeof key === 'string') { const encryptionProtocol = key as typeof activeProfile.encryptionProtocol; updateBackendConnection(activeProfile.id, { encryptionProtocol }); setSettings((current) => ({ ...current, encryptionProtocol })); } }}>
              <Label>传输加密</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover><ListBox><ListBox.Item id="none" textValue="none">none</ListBox.Item><ListBox.Item id="x25519" textValue="x25519">x25519</ListBox.Item><ListBox.Item id="ml-kem-768" textValue="ml-kem-768">ml-kem-768</ListBox.Item></ListBox></Select.Popover>
            </Select>
            {activeProfile.encryptionProtocol !== 'none' ? <Field label="加密公钥" value={activeProfile.encryptionPublicKey} onChange={(encryptionPublicKey) => updateBackendConnection(activeProfile.id, { encryptionPublicKey })} /> : null}
            <div className="flex gap-2"><Button onPress={() => (connected ? closeSocket(true) : connect())}>{connected ? '断开' : connectionState === 'error' ? '重试' : '连接'}</Button>{backendConnections.length > 1 ? <Button variant="danger-soft" onPress={() => removeBackendConnection(activeProfile.id)}>删除后端</Button> : null}</div>
          </>
        ) : null}
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
