import { useEffect, useMemo, useState } from 'react';
import { RiCameraLine, RiEyeLine, RiEyeOffLine, RiShieldCheckLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { Select, SelectItem } from '@/components/base/select/select';
import { Switch } from '@/components/base/switch/switch';
import { IconAction } from '@/components/ui/icon-action';
import type { AgentCameraCapture, AgentCameraSettingsUpdate, AgentCameraStatus, AgentDesktopSettings } from '@todex/protocol/agentDesktop';
import type { V2ApiClient } from '@todex/protocol/v2';
import { useT } from '../i18n';
import { CameraCaptureControls, CameraPicture, usePolledCameraFrame } from './AgentCamera';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './settings/SettingsRows';

const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';
const MAX_MINUTES = [1, 5, 10, 30, 60];
const MAX_FRAMES = [100, 300, 600, 1000, 2000];

/**
 * The agent camera's settings page for the active backend: the cameras are
 * the backend computer's, so the switch, the allowed cameras, the OS
 * permission and the capture defaults all live there.
 */
export function CameraSettings({ api, settings, saving, onSave }: {
  api: V2ApiClient;
  settings: AgentDesktopSettings;
  saving: boolean;
  onSave: (work: () => Promise<AgentDesktopSettings>) => void;
}) {
  const t = useT();
  const status = settings.camera;
  // Slider drags show at once; the backend hears the released value.
  const [capture, setCapture] = useState<AgentCameraCapture | undefined>(status?.capture);
  useEffect(() => { setCapture(status?.capture); }, [status?.capture.mode, status?.capture.fps, status?.capture.sensitivity]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  if (!status) return <p className="text-body-regular text-text-secondary">{t('cameraSettings.legacyBackend')}</p>;
  const update = (patch: AgentCameraSettingsUpdate) => onSave(() => api.setAgentCameraSettings(patch));
  const enabled = settings.cameraEnabled === true;
  const allowedIds = status.devices.filter(device => device.allowed).map(device => device.id);
  const granted = status.permission === 'granted';
  const minutes = Math.round(status.maxSeconds / 60);
  const minuteChoices = MAX_MINUTES.includes(minutes) ? MAX_MINUTES : [...MAX_MINUTES, minutes].sort((a, b) => a - b);
  const frameChoices = MAX_FRAMES.includes(status.maxFrames) ? MAX_FRAMES : [...MAX_FRAMES, status.maxFrames].sort((a, b) => a - b);
  return (
    <div className="flex flex-col gap-6">
      <SettingsCard>
        <SettingsRow icon={RiCameraLine} label={t('cameraSettings.enable', { host: status.host })} description={t('cameraSettings.enableHint')}>
          <Switch
            size="sm"
            aria-label={t('cameraSettings.enable', { host: status.host })}
            isSelected={enabled}
            isDisabled={saving || !status.supported}
            onChange={selected => update({ enabled: selected })}
          />
        </SettingsRow>
        {status.reason ? <SettingsNote>{status.reason}</SettingsNote> : null}
      </SettingsCard>

      {status.supported ? (
        <SettingsCard>
          <SettingsRow icon={RiShieldCheckLine} label={t('cameraSettings.permission')} description={t('cameraSettings.permissionHint', { host: status.host })}>
            {granted ? (
              <Chip variant="caption" color="lime">{t('computerSettings.granted')}</Chip>
            ) : status.permission === 'notDetermined' ? (
              <>
                {status.permissionRequest
                  ? <Chip variant="caption" color="neutral">{t('computerSettings.waiting')}</Chip>
                  : <Chip variant="caption" color="yellow">{t('computerSettings.notGranted')}</Chip>}
                <Button size="small" variant="secondary" disabled={saving || status.permissionRequest} onClick={() => onSave(() => api.requestCameraPermission())}>
                  {t('computerSettings.grant')}
                </Button>
              </>
            ) : (
              <Chip variant="caption" color="rose">{t('computerSettings.notGranted')}</Chip>
            )}
          </SettingsRow>
          {status.permission === 'denied' || status.permission === 'restricted'
            ? <SettingsNote tone="danger">{t('cameraSettings.permissionDenied', { host: status.host })}</SettingsNote>
            : <SettingsNote>{t('cameraSettings.permissionAgain')}</SettingsNote>}
        </SettingsCard>
      ) : null}

      {status.supported ? (
        <SettingsGroup label={t('cameraSettings.cameras')} description={t('cameraSettings.camerasHint')}>
          <SettingsCard>
            {status.devices.length === 0 ? <SettingsNote className="py-3">{t('cameraSettings.none', { host: status.host })}</SettingsNote> : null}
            {status.devices.map(device => (
              <div key={device.id} className="flex flex-col">
                <SettingsRow label={device.name}>
                  {device.inUse ? <Chip variant="caption" color="yellow">{t('cameraSettings.inUse')}</Chip> : null}
                  {!device.connected ? <Chip variant="caption" color="neutral">{t('cameraSettings.unplugged')}</Chip> : null}
                  {device.allowed && status.defaultDevice === device.id ? <Chip variant="caption" color="neutral">{t('cameraSettings.default')}</Chip> : null}
                  {device.connected && granted ? (
                    <IconAction
                      icon={previewing === device.id ? RiEyeOffLine : RiEyeLine}
                      size="sm"
                      aria-label={t(previewing === device.id ? 'cameraSettings.hidePreview' : 'cameraSettings.preview')}
                      onClick={() => setPreviewing(current => current === device.id ? null : device.id)}
                    />
                  ) : null}
                  <Switch
                    size="sm"
                    aria-label={t('cameraSettings.allow', { name: device.name })}
                    isSelected={device.allowed}
                    isDisabled={saving}
                    onChange={selected => update({
                      allowed: selected ? [...allowedIds, device.id] : allowedIds.filter(id => id !== device.id),
                    })}
                  />
                </SettingsRow>
                {previewing === device.id ? <SettingsPreview api={api} deviceId={device.id} name={device.name} /> : null}
              </div>
            ))}
          </SettingsCard>
        </SettingsGroup>
      ) : null}

      {status.supported && allowedIds.length > 0 ? (
        <SettingsGroup label={t('cameraSettings.capture')} description={t('cameraSettings.captureHint')}>
          <SettingsCard>
            {allowedIds.length > 1 ? (
              <SettingsRow label={t('cameraSettings.defaultCamera')} description={t('cameraSettings.defaultCameraHint')}>
                <Select
                  aria-label={t('cameraSettings.defaultCamera')}
                  selectedKey={status.defaultDevice ?? allowedIds[0]}
                  isDisabled={saving}
                  triggerClassName={ROW_SELECT_TRIGGER}
                  onSelectionChange={(value) => { if (typeof value === 'string' && value !== status.defaultDevice) update({ defaultDevice: value }); }}
                >
                  {status.devices.filter(device => device.allowed).map(device => (
                    <SelectItem key={device.id} id={device.id} textValue={device.name}>{device.name}</SelectItem>
                  ))}
                </Select>
              </SettingsRow>
            ) : null}
            <div className="py-3">
              <CameraCaptureControls
                capture={capture ?? status.capture}
                limits={status.limits}
                isDisabled={saving}
                onChange={setCapture}
                onChangeEnd={next => update({ capture: next })}
              />
            </div>
            <SettingsRow label={t('cameraSettings.maxSeconds')} description={t('cameraSettings.maxSecondsHint')}>
              <Select
                aria-label={t('cameraSettings.maxSeconds')}
                selectedKey={String(minutes)}
                isDisabled={saving}
                triggerClassName={ROW_SELECT_TRIGGER}
                onSelectionChange={(value) => {
                  const next = Number(value) * 60;
                  if (next && next !== status.maxSeconds) update({ maxSeconds: next });
                }}
              >
                {minuteChoices.map(value => (
                  <SelectItem key={value} id={String(value)} textValue={t('cameraSettings.minutes', { count: value })}>{t('cameraSettings.minutes', { count: value })}</SelectItem>
                ))}
              </Select>
            </SettingsRow>
            <SettingsRow label={t('cameraSettings.maxFrames')} description={t('cameraSettings.maxFramesHint')}>
              <Select
                aria-label={t('cameraSettings.maxFrames')}
                selectedKey={String(status.maxFrames)}
                isDisabled={saving}
                triggerClassName={ROW_SELECT_TRIGGER}
                onSelectionChange={(value) => {
                  const next = Number(value);
                  if (next && next !== status.maxFrames) update({ maxFrames: next });
                }}
              >
                {frameChoices.map(value => (
                  <SelectItem key={value} id={String(value)} textValue={t('cameraSettings.frames', { count: value })}>{t('cameraSettings.frames', { count: value })}</SelectItem>
                ))}
              </Select>
            </SettingsRow>
          </SettingsCard>
        </SettingsGroup>
      ) : null}
    </div>
  );
}

/** A camera's picture while its preview is open; closing it lets the camera turn off. */
function SettingsPreview({ api, deviceId, name }: { api: V2ApiClient; deviceId: string; name: string }) {
  const t = useT();
  const load = useMemo(() => () => api.getCameraPreview(deviceId), [api, deviceId]);
  const { frame, failed } = usePolledCameraFrame(load);
  return (
    <div className="pb-3">
      <CameraPicture frame={frame} failed={failed} alt={t('camera.previewAlt', { name })} className="max-w-md" />
    </div>
  );
}

/** The overview entry's chip. */
export function cameraSummaryStatus(settings: AgentDesktopSettings): 'legacy' | 'unsupported' | 'off' | 'permission' | 'noCamera' | 'on' {
  const camera: AgentCameraStatus | undefined = settings.camera;
  if (!camera) return 'legacy';
  if (!camera.supported) return 'unsupported';
  if (!settings.cameraEnabled) return 'off';
  if (camera.permission !== 'granted') return 'permission';
  return camera.devices.some(device => device.allowed && device.connected) ? 'on' : 'noCamera';
}
