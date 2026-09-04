import { useCallback, useRef, useState } from 'react';
import { ChevronRight, Thunderbolt, ThunderboltFill } from '@gravity-ui/icons';
import { ListBox, Select, Tooltip } from '@heroui/react';
import type { ProviderModelDescriptor } from '@todex/protocol/v2';
import type { TodeXSession } from '../session/useTodeXSession';
import { reasoningEffortLabel, modelDisplayLabel } from '../session/helpers';

interface ModelReasoningCardProps {
  currentModel: string;
  currentModelDescriptor?: ProviderModelDescriptor;
  modelCatalog: TodeXSession['modelCatalog'];
  providerModels: ProviderModelDescriptor[];
  supportedReasoningEfforts: string[];
  currentReasoningEffort: string | null;
  displayedReasoningEffort: string | null;
  fastEnabled?: boolean;
  canToggleFast?: boolean;
  onToggleFast?: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (effort: string) => void;
}

export function ModelReasoningCard({
  currentModel,
  currentModelDescriptor,
  modelCatalog,
  providerModels,
  supportedReasoningEfforts,
  currentReasoningEffort,
  displayedReasoningEffort,
  fastEnabled = false,
  canToggleFast = false,
  onToggleFast,
  onSelectModel,
  onSelectReasoningEffort,
}: ModelReasoningCardProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const modelDisplayName =
    currentModelDescriptor?.displayName || modelDisplayLabel(currentModel, modelCatalog);

  const effortLabel = displayedReasoningEffort
    ? reasoningEffortLabel(displayedReasoningEffort)
    : null;

  const totalSteps = supportedReasoningEfforts.length;
  const currentIndex = Math.max(
    0,
    supportedReasoningEfforts.indexOf(displayedReasoningEffort ?? '')
  );

  const updateEffortByIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(totalSteps - 1, Math.round(index)));
      const nextEffort = supportedReasoningEfforts[clamped];
      if (nextEffort && nextEffort !== currentReasoningEffort) {
        onSelectReasoningEffort(nextEffort);
      }
    },
    [supportedReasoningEfforts, currentReasoningEffort, onSelectReasoningEffort, totalSteps]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (totalSteps <= 1) return;
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const inset = 14;
    const availableWidth = rect.width - inset * 2;
    if (availableWidth <= 0) return;

    const clampedX = Math.max(0, Math.min(availableWidth, x - inset));
    const fraction = clampedX / availableWidth;
    const nextIndex = Math.round(fraction * (totalSteps - 1));
    updateEffortByIndex(nextIndex);

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || totalSteps <= 1) return;
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const inset = 14;
    const availableWidth = rect.width - inset * 2;
    if (availableWidth <= 0) return;

    const clampedX = Math.max(0, Math.min(availableWidth, x - inset));
    const fraction = clampedX / availableWidth;
    const nextIndex = Math.round(fraction * (totalSteps - 1));
    updateEffortByIndex(nextIndex);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore pointer capture release error if already lost
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (totalSteps <= 1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateEffortByIndex(currentIndex + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      updateEffortByIndex(currentIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      updateEffortByIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      updateEffortByIndex(totalSteps - 1);
    }
  };

  const thumbPositionStyle =
    totalSteps <= 1
      ? '50%'
      : `calc(14px + (100% - 28px) * ${currentIndex / (totalSteps - 1)})`;

  const fillWidthStyle =
    totalSteps <= 1
      ? '100%'
      : currentIndex === totalSteps - 1
        ? '100%'
        : `calc(14px + (100% - 28px) * ${currentIndex / (totalSteps - 1)})`;

  return (
    <div className="composer-model-card">
      {/* Top row: Fast toggle & Model + Reasoning Trigger */}
      <div className="composer-model-card__header">
        {canToggleFast ? (
          <div className="composer-model-card__fast-wrapper">
            <Tooltip delay={200}>
              <button
                type="button"
                className={`composer-model-card__fast-btn ${fastEnabled ? 'is-active' : ''}`}
                onClick={onToggleFast}
                aria-label={fastEnabled ? '关闭 Fast 模式' : '启用 Fast 模式'}
              >
                {fastEnabled ? (
                  <ThunderboltFill className="size-4" aria-hidden="true" />
                ) : (
                  <Thunderbolt className="size-4" aria-hidden="true" />
                )}
              </button>
              <Tooltip.Content>{fastEnabled ? '关闭 Fast' : '启用 Fast'}</Tooltip.Content>
            </Tooltip>
          </div>
        ) : null}

        {/* Model dropdown trigger */}
        <Select
          className="composer-model-card__select"
          selectedKey={currentModel || null}
          onSelectionChange={(key) => {
            if (typeof key === 'string' && key) {
              onSelectModel(key);
            }
          }}
          aria-label="选择模型"
        >
          <Select.Trigger className="composer-model-card__trigger">
            <Select.Value>
              <span className="composer-model-card__model-title">{modelDisplayName}</span>
              {effortLabel ? (
                <span className="composer-model-card__effort-badge">{effortLabel}</span>
              ) : null}
            </Select.Value>
            <ChevronRight className="composer-model-card__chevron" aria-hidden="true" />
          </Select.Trigger>
          <Select.Popover className="composer-model-card__dropdown" placement="bottom" offset={8}>
            <ListBox className="composer-model-card__listbox">
              {providerModels.map((item) => (
                <ListBox.Item key={item.id} id={item.id} textValue={item.displayName} className="composer-model-card__list-item">
                  <span>{item.displayName}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {/* Bottom row: Stepped Slider */}
      {totalSteps > 0 ? (
        <div
          ref={trackRef}
          className={`composer-model-card__track ${isDragging ? 'is-dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label="思考强度"
          aria-valuemin={0}
          aria-valuemax={totalSteps - 1}
          aria-valuenow={currentIndex}
          aria-valuetext={effortLabel ?? 'default'}
        >
          {/* Active green fill */}
          <div
            className="composer-model-card__fill"
            style={{
              width: fillWidthStyle,
              borderRadius: currentIndex === totalSteps - 1 ? '9999px' : '9999px 0 0 9999px',
            }}
          />

          {/* Stepped discrete dots */}
          <div className="composer-model-card__marks" aria-hidden="true">
            {supportedReasoningEfforts.map((effort, index) => {
              const pos =
                totalSteps === 1
                  ? '50%'
                  : `calc(14px + (100% - 28px) * ${index / (totalSteps - 1)})`;
              const isPast = index < currentIndex;
              return (
                <span
                  key={effort}
                  className={`composer-model-card__dot ${isPast ? 'is-past' : 'is-future'}`}
                  style={{ left: pos }}
                />
              );
            })}
          </div>

          {/* Tactile pure white thumb */}
          <div
            className="composer-model-card__thumb"
            style={{ left: thumbPositionStyle }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <div className="composer-model-card__no-effort">
          当前模型不支持调整思考强度
        </div>
      )}
    </div>
  );
}
