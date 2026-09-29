import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Thunderbolt, ThunderboltFill } from '@gravity-ui/icons';
import { Dropdown, EmptyState, SearchField, Tooltip, useFilter } from '@heroui/react';
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
  const menuScopeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const { contains } = useFilter({ sensitivity: 'base' });

  // Focus the search input once the popover content is mounted so typing
  // filters immediately.
  useEffect(() => {
    if (isPickerOpen) searchInputRef.current?.focus();
  }, [isPickerOpen]);

  // Models tagged with a `family` show in a two-pane layout: the left pane
  // lists untagged models plus one row per family, and the right pane shows
  // the active family's versions ("latest" alias first, then pinned versions).
  const { ungroupedModels, familyGroups } = useMemo(() => {
    const ungroupedModels: ProviderModelDescriptor[] = [];
    const groups = new Map<string, ProviderModelDescriptor[]>();
    for (const item of providerModels) {
      const family = item.family?.trim().toLowerCase();
      if (!family) {
        ungroupedModels.push(item);
        continue;
      }
      const group = groups.get(family);
      if (group) {
        group.push(item);
      } else {
        groups.set(family, [item]);
      }
    }
    return {
      ungroupedModels,
      familyGroups: [...groups].map(([family, items]) => ({ family, items })),
    };
  }, [providerModels]);

  const searchQuery = modelSearch.trim();
  const filteredModels = searchQuery
    ? providerModels.filter(
        (item) => contains(item.displayName, searchQuery) || contains(item.id, searchQuery),
      )
    : null;
  const selectedKeys = useMemo(() => (currentModel ? [currentModel] : []), [currentModel]);

  const currentFamily = useMemo(() => {
    const match = providerModels.find((item) => item.id === currentModel);
    return match?.family?.trim().toLowerCase() || null;
  }, [providerModels, currentModel]);

  const activeGroup =
    familyGroups.find((group) => group.family === activeFamily) ?? familyGroups[0] ?? null;

  // The left pane marks the family containing the current model as selected,
  // or the untagged model itself when it has no family.
  const familyPaneSelectedKeys = useMemo(
    () => (currentFamily ? [`family:${currentFamily}`] : selectedKeys),
    [currentFamily, selectedKeys],
  );

  const handlePickerOpenChange = useCallback(
    (isOpen: boolean) => {
      setPickerOpen(isOpen);
      if (isOpen) {
        setModelSearch('');
        setActiveFamily(currentFamily ?? familyGroups[0]?.family ?? null);
      }
    },
    [currentFamily, familyGroups],
  );

  const familyLabel = (family: string) => family.charAt(0).toUpperCase() + family.slice(1);

  const familyItemRefs = useRef(new Map<string, HTMLElement>());

  const focusVersionItem = useCallback((fromEnd = false) => {
    const items = menuScopeRef.current?.querySelectorAll<HTMLElement>(
      '.composer-model-card__versions [role="menuitemradio"], .composer-model-card__versions [role="menuitem"], .composer-model-card__versions [role="menuitemcheckbox"]',
    );
    if (!items?.length) return;
    (fromEnd ? items[items.length - 1] : items[0]).focus();
  }, []);

  const focusFirstMenuItem = useCallback((fromEnd = false) => {
    const items = menuScopeRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
    );
    if (!items?.length) return;
    (fromEnd ? items[items.length - 1] : items[0]).focus();
  }, []);

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
        <Dropdown
          className="composer-model-card__select"
          isOpen={isPickerOpen}
          onOpenChange={handlePickerOpenChange}
        >
          <Dropdown.Trigger className="composer-model-card__trigger" aria-label="选择模型">
            <span className="composer-model-card__value">
              <span className="composer-model-card__model-title">{modelDisplayName}</span>
              {effortLabel ? (
                <span className="composer-model-card__effort-badge">{effortLabel}</span>
              ) : null}
            </span>
            <ChevronRight className="composer-model-card__chevron" aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Popover className="composer-model-card__dropdown" placement="bottom" offset={8}>
            <SearchField
              autoFocus
              aria-label="搜索模型"
              className="composer-model-card__search"
              variant="secondary"
              value={modelSearch}
              onChange={setModelSearch}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  ref={searchInputRef}
                  placeholder="搜索模型…"
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusFirstMenuItem();
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusFirstMenuItem(true);
                    }
                  }}
                />
                <SearchField.ClearButton aria-label="清除搜索" />
              </SearchField.Group>
            </SearchField>
            <div ref={menuScopeRef} className="composer-model-card__menu-scope">
              {filteredModels ? (
                filteredModels.length === 0 ? (
                  <EmptyState className="composer-model-card__empty">未找到匹配的模型</EmptyState>
                ) : (
                  <Dropdown.Menu
                    className="composer-model-card__listbox"
                    aria-label="选择模型"
                    autoFocus={false}
                    selectionMode="single"
                    selectedKeys={selectedKeys}
                    onAction={(key) => onSelectModel(String(key))}
                  >
                    {filteredModels.map((item) => (
                      <Dropdown.Item key={item.id} id={item.id} textValue={item.displayName} className="composer-model-card__list-item">
                        <span className="composer-model-card__option-name">{item.displayName}</span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                )
              ) : providerModels.length === 0 ? (
                <EmptyState className="composer-model-card__empty">未找到匹配的模型</EmptyState>
              ) : (
                familyGroups.length === 0 ? (
                  <Dropdown.Menu
                    className="composer-model-card__listbox"
                    aria-label="选择模型"
                    autoFocus={false}
                    selectionMode="single"
                    selectedKeys={selectedKeys}
                    onAction={(key) => onSelectModel(String(key))}
                  >
                    {providerModels.map((item) => (
                      <Dropdown.Item key={item.id} id={item.id} textValue={item.displayName} className="composer-model-card__list-item">
                        <span className="composer-model-card__option-name">{item.displayName}</span>
                        <Dropdown.ItemIndicator />
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                ) : (
                  <div className="composer-model-card__split">
                    <div
                      className="composer-model-card__families"
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowRight') return;
                        const target = event.target as HTMLElement;
                        for (const el of familyItemRefs.current.values()) {
                          if (el === target || el.contains(target)) {
                            event.preventDefault();
                            event.stopPropagation();
                            focusVersionItem();
                            break;
                          }
                        }
                      }}
                    >
                      <Dropdown.Menu
                        className="composer-model-card__listbox"
                        aria-label="模型系列"
                        autoFocus={false}
                        selectionMode="single"
                        selectedKeys={familyPaneSelectedKeys}
                        onAction={(key) => {
                          const id = String(key);
                          if (id.startsWith('family:')) setActiveFamily(id.slice(7));
                          else onSelectModel(id);
                        }}
                      >
                        {ungroupedModels.map((item) => (
                          <Dropdown.Item key={item.id} id={item.id} textValue={item.displayName} className="composer-model-card__list-item">
                            <span className="composer-model-card__option-name">{item.displayName}</span>
                            <Dropdown.ItemIndicator />
                          </Dropdown.Item>
                        ))}
                        {familyGroups.map((group) => (
                          <Dropdown.Item
                            key={group.family}
                            id={`family:${group.family}`}
                            ref={(el) => {
                              if (el) familyItemRefs.current.set(group.family, el);
                              else familyItemRefs.current.delete(group.family);
                            }}
                            textValue={familyLabel(group.family)}
                            shouldCloseOnSelect={false}
                            className={`composer-model-card__list-item ${group.family === activeGroup?.family ? 'is-active' : ''}`}
                            onHoverStart={() => setActiveFamily(group.family)}
                            onFocusChange={(focused) => {
                              if (focused) setActiveFamily(group.family);
                            }}
                          >
                            <span className="composer-model-card__option-name">{familyLabel(group.family)}</span>
                            <Dropdown.ItemIndicator />
                            <ChevronRight className="composer-model-card__option-chevron" aria-hidden="true" />
                          </Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </div>
                    {activeGroup ? (
                      <div
                        className="composer-model-card__versions"
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            event.stopPropagation();
                            familyItemRefs.current.get(activeGroup.family)?.focus();
                          }
                        }}
                      >
                        <Dropdown.Menu
                          key={activeGroup.family}
                          className="composer-model-card__listbox"
                          aria-label={`${familyLabel(activeGroup.family)} 版本`}
                          autoFocus={false}
                          selectionMode="single"
                          selectedKeys={selectedKeys}
                          onAction={(key) => onSelectModel(String(key))}
                        >
                          {activeGroup.items.map((item) => (
                            <Dropdown.Item
                              key={item.id}
                              id={item.id}
                              textValue={item.displayName}
                              className="composer-model-card__list-item"
                            >
                              <span className="composer-model-card__option-name">
                                {item.id === activeGroup.family ? '最新' : item.displayName}
                                {item.id === activeGroup.family && item.description ? (
                                  <span className="composer-model-card__option-detail">{item.description}</span>
                                ) : null}
                              </span>
                              <Dropdown.ItemIndicator />
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Menu>
                      </div>
                    ) : null}
                  </div>
                )
              )}
            </div>
          </Dropdown.Popover>
        </Dropdown>
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
