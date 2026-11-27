import { useEffect, useMemo, useState } from 'react';
import { RiArrowDownSLine, RiArrowUpSLine, RiCameraLine, RiCheckLine, RiCloseLine, RiStopCircleLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control';
import { Select, SelectItem } from '@/components/base/select/select';
import { Slider } from '@/components/base/slider/slider';
import { IconAction } from '@/components/ui/icon-action';
import { toast } from '@/components/ui/toast-store';
import { cx } from '@/utils/cx';
import {
  DESKTOP_CAMERA_KIND,
  type AgentCameraCapture,
  type AgentCameraLimits,
  type CameraFrame,
  type DesktopCameraChoice,
  type DesktopCameraDetails,
} from '@todex/protocol/agentDesktop';
import type { DesktopCameraState } from '@todex/protocol/conversationRuntime';
import { permissionActions, type PendingRequest, type PermissionOption } from '@todex/protocol/todex';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { backendApi } from '../session/helpers';
import { agentToolRequestTitle } from '../session/completionNotifications';

/** Polling cadence of a camera preview while it is shown. */
const PREVIEW_INTERVAL_MS = 400;
/** The recording view also reads progress; a slower beat is enough. */
const LIVE_INTERVAL_MS = 1000;
/** After a failed frame (camera starting, card answered): wait longer. */
const RETRY_MS = 1500;
const ROW_SELECT_TRIGGER = 'h-8 w-auto gap-1 rounded-lg px-2 py-1.5';

type CaptureLimits = Pick<AgentCameraLimits, 'fps' | 'sensitivity'>;

/** The fps shown on sliders and chips: at most one decimal. */
export function formatFps(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Polls `load` while `enabled` and the page is visible; `null` until the
 * first frame and after a failure. Polling keeps the camera on at the
 * backend, so stopping (unmount, `enabled` false) lets it turn off.
 */
export function usePolledCameraFrame(load: (() => Promise<CameraFrame>) | null, interval = PREVIEW_INTERVAL_MS) {
  const [frame, setFrame] = useState<CameraFrame | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFrame(null);
    setFailed(false);
    if (!load) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let delay = interval;
      if (document.visibilityState === 'visible') {
        try {
          const next = await load();
          if (alive) { setFrame(next); setFailed(false); }
        } catch {
          if (alive) setFailed(true);
          delay = RETRY_MS;
        }
      }
      if (alive) timer = setTimeout(() => { void tick(); }, delay);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [load, interval]);
  return { frame, failed };
}

/** A camera picture in a 16:9 box, or why there is none. */
export function CameraPicture({ frame, failed, alt, className }: {
  frame: CameraFrame | null;
  failed: boolean;
  alt: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cx('flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-background-secondary-default', className)}>
      {frame ? (
        <img src={frame.dataUrl} alt={alt} className="h-full w-full object-contain" />
      ) : (
        <p className="px-4 text-center text-caption-1-regular text-text-secondary">
          {failed ? t('camera.previewFailed') : t('camera.previewWaiting')}
        </p>
      )}
    </div>
  );
}

/** Fixed or dynamic capture, and its rate or sensitivity. */
export function CameraCaptureControls({ capture, limits, isDisabled, onChange, onChangeEnd }: {
  capture: AgentCameraCapture;
  limits: CaptureLimits;
  isDisabled?: boolean;
  /** Every change, slider drags included. */
  onChange: (capture: AgentCameraCapture) => void;
  /** Settled changes: a mode switch, a released slider. */
  onChangeEnd?: (capture: AgentCameraCapture) => void;
}) {
  const t = useT();
  const fixed = capture.mode === 'fixed';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-medium text-text-primary">{t('camera.mode')}</p>
          <p className="text-caption-1-regular text-text-secondary">{t(fixed ? 'camera.modeFixedHint' : 'camera.modeDynamicHint')}</p>
        </div>
        <SegmentedControl
          aria-label={t('camera.mode')}
          isDisabled={isDisabled}
          selectedKeys={[capture.mode]}
          onSelectionChange={(keys) => {
            const [mode] = [...keys] as AgentCameraCapture['mode'][];
            if (!mode || mode === capture.mode) return;
            const next = { ...capture, mode };
            onChange(next);
            onChangeEnd?.(next);
          }}
        >
          <SegmentedControlItem id="dynamic">{t('camera.modeDynamic')}</SegmentedControlItem>
          <SegmentedControlItem id="fixed">{t('camera.modeFixed')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      {fixed ? (
        <Slider
          label={t('camera.fps')}
          thumbLabel={t('camera.fps')}
          minValue={limits.fps.min}
          maxValue={limits.fps.max}
          step={0.1}
          isDisabled={isDisabled}
          value={capture.fps}
          formatValue={(value) => t('camera.fpsValue', { value: formatFps(value) })}
          onChange={(value) => onChange({ ...capture, fps: value })}
          onChangeEnd={(value) => onChangeEnd?.({ ...capture, fps: value })}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <Slider
            label={t('camera.sensitivity')}
            thumbLabel={t('camera.sensitivity')}
            minValue={limits.sensitivity.min}
            maxValue={limits.sensitivity.max}
            step={1}
            isDisabled={isDisabled}
            value={capture.sensitivity}
            onChange={(value) => onChange({ ...capture, sensitivity: value })}
            onChangeEnd={(value) => onChangeEnd?.({ ...capture, sensitivity: value })}
          />
          <p className="text-caption-1-regular text-text-secondary">{t('camera.sensitivityHint')}</p>
        </div>
      )}
    </div>
  );
}

/** The card's details, when the request is a well-formed camera card. */
export function cameraRequestDetails(request: PendingRequest): DesktopCameraDetails | undefined {
  if (request.data.kind !== DESKTOP_CAMERA_KIND) return undefined;
  const details = request.data.details as Partial<DesktopCameraDetails> | undefined;
  if (!details || !Array.isArray(details.devices) || details.devices.length === 0 || typeof details.deviceId !== 'string'
    || !details.capture || !details.limits) return undefined;
  return details as DesktopCameraDetails;
}

/**
 * The approval card of `camera_start`: a live preview of the chosen camera
 * (turning it on is what the preview costs), the camera, and how frames are
 * captured. Allowing sends those choices with the answer.
 */
export function CameraRequestCard({ session, conversationId, request, details, onSelect }: {
  session: TodeXSession;
  /** The backend's (v2) conversation id. */
  conversationId: string;
  request: PendingRequest;
  details: DesktopCameraDetails;
  onSelect: (option: boolean | PermissionOption, data?: Record<string, unknown>) => void;
}) {
  const t = useT();
  const [deviceId, setDeviceId] = useState(details.deviceId);
  const [capture, setCapture] = useState<AgentCameraCapture>(details.capture);
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl],
  );
  const load = useMemo(() => () => api.getCameraFrame(conversationId, deviceId), [api, conversationId, deviceId]);
  const { frame, failed } = usePolledCameraFrame(load);
  const device = details.devices.find(item => item.id === deviceId) ?? details.devices[0];
  const options = permissionActions(request);
  const choice: DesktopCameraChoice = { deviceId, capture };
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-3 shadow-xs">
      <div className="flex items-start gap-2">
        <RiCameraLine className="mt-0.5 size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-body-medium text-text-primary">{agentToolRequestTitle(request, t) ?? request.title}</p>
          <p className="mt-0.5 text-body-2-regular text-text-secondary">
            {t('camera.cardHint', { minutes: Math.max(1, Math.round(details.maxSeconds / 60)), frames: details.maxFrames })}
          </p>
        </div>
      </div>
      <CameraPicture frame={frame} failed={failed} alt={t('camera.previewAlt', { name: device.name })} className="max-w-sm" />
      {details.devices.length > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-body-medium text-text-primary">{t('camera.device')}</p>
          <Select
            aria-label={t('camera.device')}
            selectedKey={deviceId}
            triggerClassName={ROW_SELECT_TRIGGER}
            onSelectionChange={(value) => { if (typeof value === 'string') setDeviceId(value); }}
          >
            {details.devices.map(item => <SelectItem key={item.id} id={item.id} textValue={item.name}>{item.name}</SelectItem>)}
          </Select>
        </div>
      ) : null}
      <CameraCaptureControls capture={capture} limits={details.limits} onChange={setCapture} />
      <div className="flex flex-wrap gap-2">
        {options.map(option => {
          const allow = typeof option === 'boolean' ? option : option.kind.startsWith('allow');
          const label = typeof option === 'boolean'
            ? t(option ? 'runStatus.approve' : 'runStatus.reject')
            : option.optionId === 'conversation' ? t('runStatus.allowConversation')
              : option.optionId === 'once' ? t('runStatus.allowOnce')
                : allow ? option.name : t('runStatus.reject');
          return (
            <Button
              key={typeof option === 'boolean' ? String(option) : option.optionId}
              size="small"
              variant={allow ? 'primary' : 'danger'}
              leadingIcon={allow ? RiCheckLine : RiCloseLine}
              onClick={() => onSelect(option, allow ? choice : undefined)}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * While the conversation's agent records a camera: what it sees, how far
 * the session got, and Stop. Pinned above the composer, collapsible.
 */
export function CameraLiveView({ session, conversationId, state }: {
  session: TodeXSession;
  /** The backend's (v2) conversation id. */
  conversationId: string;
  state: DesktopCameraState | undefined;
}) {
  const t = useT();
  const [folded, setFolded] = useState(false);
  const [stopping, setStopping] = useState(false);
  const active = Boolean(state?.active);
  const api = useMemo(
    () => backendApi(session.settings),
    [session.settings.deviceSecret, session.settings.encryptionProtocol, session.settings.encryptionPublicKey, session.settings.transportVerified, session.settings.serverUrl],
  );
  // Progress comes with each frame, so it polls folded too (without the picture).
  const load = useMemo(() => (active ? () => api.getCameraFrame(conversationId) : null), [active, api, conversationId]);
  const { frame, failed } = usePolledCameraFrame(load, LIVE_INTERVAL_MS);
  if (!active) return null;
  const name = frame?.session?.deviceName ?? state?.deviceName ?? t('camera.device');
  const progress = frame?.session?.progress;
  const capture = frame?.session?.capture ?? state?.capture;
  const stop = async () => {
    setStopping(true);
    try {
      await api.revokeAgentDesktop(conversationId, 'camera');
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : t('cameraLive.stopFailed'));
    } finally {
      setStopping(false);
    }
  };
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-chart-8 bg-background-primary-default">
      <div className="flex items-center gap-2 px-3 py-2">
        <RiCameraLine className="size-4 shrink-0 text-status-yellow-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption-1-medium text-text-primary">{t('cameraLive.title', { name })}</p>
          <p className="truncate text-caption-1-regular text-text-tertiary">
            {progress
              ? t('cameraLive.progress', { frames: progress.frames, elapsed: formatElapsed(progress.elapsedMs) })
              : t('cameraLive.starting')}
            {progress && capture?.mode === 'dynamic'
              ? ` · ${t('cameraLive.change', { kbps: formatFps(progress.changeKbps), rate: formatFps(progress.rateFps) })}`
              : ''}
          </p>
        </div>
        {frame ? <Chip variant="caption" color="yellow">{t('computerLive.live')}</Chip> : null}
        <IconAction
          icon={folded ? RiArrowUpSLine : RiArrowDownSLine}
          size="sm"
          aria-label={folded ? t('computerLive.expand') : t('computerLive.collapse')}
          onClick={() => setFolded(value => !value)}
        />
        <Button size="small" variant="danger" leadingIcon={RiStopCircleLine} disabled={stopping} onClick={() => { void stop(); }}>
          {t('computerLive.stop')}
        </Button>
      </div>
      {folded ? null : (
        <div className="px-3 pb-3">
          <CameraPicture frame={frame} failed={failed} alt={t('camera.previewAlt', { name })} className="max-w-sm" />
        </div>
      )}
    </div>
  );
}
