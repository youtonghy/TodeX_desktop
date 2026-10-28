import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine, RiCloseCircleFill, RiSearchLine } from '@remixicon/react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Button as AriaButton,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
  useFilter,
  type Key,
  type MenuItemProps as AriaMenuItemProps,
} from 'react-aria-components';
import type { ProviderModelDescriptor } from '@todex/protocol/v2';
import { normalizeReasoningEffort } from '@todex/protocol/todex';
import { MENU_POPOVER_SURFACE } from '@/components/base/dropdown/menu-styles';
import { InputBase, TextField } from '@/components/base/input/input';
import { RadioDot } from '@/components/base/radio/radio';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cx } from '@/utils/cx';
import type { TodeXSession } from '../session/useTodeXSession';
import { reasoningEffortLabel, modelDisplayLabel } from '../session/helpers';

// Pretty labels for vendor-style families emitted by providers like Devin
// (vendor token of the model id) and Pi (provider prefix). Anything unknown
// falls back to capitalizing the family key.
const FAMILY_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  cerebras: 'Cerebras',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  glm: 'GLM',
  google: 'Google',
  gpt: 'GPT',
  grok: 'Grok',
  groq: 'Groq',
  kimi: 'Kimi',
  meta: 'Meta',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  moonshot: 'Moonshot',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  qwen: 'Qwen',
  swe: 'SWE',
  xai: 'xAI',
  zai: 'Z.ai',
  zhipu: 'Zhipu',
};

/** Reasoning effort → its color on a model trigger (composer, schedule dialog). */
export const EFFORT_TEXT: Record<string, string> = {
  none: 'text-effort-none',
  minimal: 'text-effort-minimal',
  low: 'text-effort-low',
  medium: 'text-effort-medium',
  high: 'text-effort-high',
  xhigh: 'text-effort-xhigh',
  max: 'text-effort-xhigh',
  ultra: 'text-effort-xhigh',
  ultracode: 'text-effort-xhigh',
};

/* The effort slider follows the BoardUI EffortSlider geometry: the 21px thumb
 * travels edge to edge, so stop centers run from half a thumb in on the left
 * to half a thumb in on the right. */
const THUMB_WIDTH = 21;
const THUMB_INSET = THUMB_WIDTH / 2;

const stopPosition = (fraction: number) => `calc(${THUMB_INSET}px + (100% - ${THUMB_WIDTH}px) * ${fraction})`;

const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/** A model / family row in the BoardUI model-picker recipe: rounded-2lg,
 *  lifted on hover and focus, radio dot for the chosen entry. */
function ModelMenuItem({ className, children, trailing, ref, ...props }: Omit<AriaMenuItemProps, 'children' | 'className'> & {
  className?: string;
  children: ReactNode;
  trailing?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <AriaMenuItem
      {...props}
      ref={ref}
      className={({ isFocused, isHovered, isSelected }) => cx(
        'flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-start text-body-medium text-text-primary outline-none',
        'transition-colors duration-150 ease',
        (isFocused || isHovered || isSelected) && 'bg-background-primary-hover',
        className,
      )}
    >
      {({ isSelected }) => (
        <>
          <span className="min-w-0 flex-1 wrap-anywhere">{children}</span>
          <RadioDot size="sm" selected={isSelected} />
          {trailing}
        </>
      )}
    </AriaMenuItem>
  );
}

function ModelMenu({ label, selectedKeys, onAction, className, children }: {
  label: string;
  className?: string;
  selectedKeys: Iterable<Key>;
  onAction: (key: Key) => void;
  children: ReactNode;
}) {
  return (
    <ScrollArea className={className ?? 'max-h-56'}>
      <AriaMenu
        aria-label={label}
        autoFocus={false}
        selectionMode="single"
        selectedKeys={selectedKeys}
        onAction={onAction}
        className="flex w-full flex-col gap-0.5 outline-none"
      >
        {children}
      </AriaMenu>
    </ScrollArea>
  );
}

interface ModelReasoningCardProps {
  currentModel: string;
  currentModelDescriptor?: ProviderModelDescriptor;
  modelCatalog: TodeXSession['modelCatalog'];
  providerModels: ProviderModelDescriptor[];
  supportedReasoningEfforts: string[];
  currentReasoningEffort: string | null;
  displayedReasoningEffort: string | null;
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
  onSelectModel,
  onSelectReasoningEffort,
}: ModelReasoningCardProps) {
  const reduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const menuScopeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [isPickerOpen, setPickerOpen] = useState(false);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const { contains } = useFilter({ sensitivity: 'base' });

  // Focus the search input once the picker's focus scope is in place, so
  // typing filters immediately. Focusing it any earlier (autoFocus during the
  // commit) looks like focus escaping the outer panel, whose focus trap pulls
  // it back and ends up closing both popovers.
  useEffect(() => {
    if (!isPickerOpen) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
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

  const familyLabel = (family: string) =>
    FAMILY_LABELS[family] ?? family.charAt(0).toUpperCase() + family.slice(1);

  const familyItemRefs = useRef(new Map<string, HTMLElement>());

  const focusVersionItem = useCallback((fromEnd = false) => {
    const items = menuScopeRef.current
      ?.querySelector('[data-model-pane="versions"]')
      ?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR);
    if (!items?.length) return;
    (fromEnd ? items[items.length - 1] : items[0]).focus();
  }, []);

  const focusFirstMenuItem = useCallback((fromEnd = false) => {
    const items = menuScopeRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR);
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
  // Level key drives the per-intensity color ramp in CSS. When the displayed
  // effort is unset, tint by the step currently under the thumb instead.
  const effortLevel =
    normalizeReasoningEffort(displayedReasoningEffort) ??
    normalizeReasoningEffort(supportedReasoningEfforts[currentIndex]) ??
    undefined;

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

  const indexAtPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    const availableWidth = rect.width - THUMB_INSET * 2;
    if (availableWidth <= 0) return null;
    const clampedX = Math.max(0, Math.min(availableWidth, clientX - rect.left - THUMB_INSET));
    return Math.round((clampedX / availableWidth) * (totalSteps - 1));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (totalSteps <= 1) return;
    const nextIndex = indexAtPointer(e.clientX);
    if (nextIndex === null) return;
    updateEffortByIndex(nextIndex);

    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || totalSteps <= 1) return;
    const nextIndex = indexAtPointer(e.clientX);
    if (nextIndex === null) return;
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

  const fraction = totalSteps <= 1 ? 0.5 : currentIndex / (totalSteps - 1);
  // The fill reaches the thumb's trailing edge, so it lands flush against it.
  const fillWidthStyle = totalSteps <= 1 ? '100%' : `calc(${fraction} * (100% - ${THUMB_WIDTH}px) + ${THUMB_WIDTH}px)`;

  // The picker is a dialog (search plus menus), so picking closes it here.
  const pickModel = (id: string) => {
    onSelectModel(id);
    setPickerOpen(false);
  };
  const selectModel = (key: Key) => pickModel(String(key));
  const modelRow = (item: ProviderModelDescriptor) => (
    <ModelMenuItem key={item.id} id={item.id} textValue={item.displayName}>
      {item.displayName}
    </ModelMenuItem>
  );

  return (
    <div className="composer-model-card flex flex-col gap-3 px-3 pt-2.5 pb-3" data-effort={effortLevel}>
      {/* Top row: Model + Reasoning Trigger */}
      <div className="relative flex min-h-8 items-center justify-center">

        {/* Model picker: a nested dialog popover (search field plus menus).
            A MenuTrigger here opened on pointer down and fought the outer
            panel's focus scope, so the release closed both popovers. */}
        <AriaDialogTrigger isOpen={isPickerOpen} onOpenChange={handlePickerOpenChange}>
          <AriaButton
            aria-label="选择模型"
            className={cx(
              'flex min-w-0 max-w-full cursor-pointer items-center justify-center gap-0.5 rounded-xl py-1 ps-2 pe-1 outline-none',
              'transition-colors duration-150 ease hover:bg-background-primary-hover data-[pressed]:bg-background-primary-active',
              'focus-visible:ring-2 focus-visible:ring-border-focus-ring',
            )}
          >
            <span className="flex min-w-0 items-baseline gap-1.5 px-0.5 text-headline-semibold">
              <span className="truncate text-text-primary">{modelDisplayName}</span>
              {effortLabel ? (
                <motion.span
                  key={effortLabel}
                  initial={reduceMotion ? false : { opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className="shrink-0 whitespace-nowrap text-(--effort-color)"
                >
                  {effortLabel}
                </motion.span>
              ) : null}
            </span>
            <RiArrowDownSLine
              aria-hidden="true"
              className={cx(
                'size-[18px] shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease',
                isPickerOpen && 'rotate-180',
              )}
            />
          </AriaButton>
          <AriaPopover
            placement="bottom"
            offset={8}
            className={cx(MENU_POPOVER_SURFACE, 'flex w-96 min-w-[min(13rem,calc(100vw-2rem))] flex-col overflow-hidden p-1.5')}
          >
            <AriaDialog aria-label="选择模型" className="flex min-h-0 flex-col outline-none">
            <TextField
              aria-label="搜索模型"
              size="small"
              type="search"
              value={modelSearch}
              onChange={setModelSearch}
              className="shrink-0 border-b border-separator-border px-0.5 pt-0.5 pb-1.5"
            >
              <div className="relative w-full">
                <InputBase
                  ref={searchInputRef}
                  leadingIcon={RiSearchLine}
                  placeholder="搜索模型…"
                  fieldClassName={cx(modelSearch && 'pe-8')}
                  className="[&::-webkit-search-cancel-button]:hidden"
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusFirstMenuItem();
                    } else if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusFirstMenuItem(true);
                    } else if (event.key === 'Escape' && modelSearch) {
                      // First Escape clears the query, the next one closes the menu.
                      event.preventDefault();
                      event.stopPropagation();
                      setModelSearch('');
                    }
                  }}
                />
                {modelSearch ? (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => {
                      setModelSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute end-2 top-1/2 flex -translate-y-1/2 cursor-pointer items-center rounded-full text-foreground-icon-tertiary outline-none transition-colors duration-150 ease hover:text-foreground-icon-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                  >
                    <RiCloseCircleFill aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
            </TextField>
            <div ref={menuScopeRef} className="flex min-h-0 flex-col pt-1.5">
              {filteredModels ? (
                filteredModels.length === 0 ? (
                  <EmptyState size="sm" title="未找到匹配的模型" />
                ) : (
                  <ModelMenu label="选择模型" selectedKeys={selectedKeys} onAction={selectModel}>
                    {filteredModels.map(modelRow)}
                  </ModelMenu>
                )
              ) : providerModels.length === 0 ? (
                <EmptyState size="sm" title="未找到匹配的模型" />
              ) : (
                familyGroups.length === 0 ? (
                  <ModelMenu label="选择模型" selectedKeys={selectedKeys} onAction={selectModel}>
                    {providerModels.map(modelRow)}
                  </ModelMenu>
                ) : (
                  // Fixed height so hovering families with different model counts
                  // doesn't resize (and re-flip) the popover; panes scroll instead.
                  <div className="flex h-56 min-h-0">
                    <div
                      className="me-1 w-38 shrink-0 border-e border-separator-border pe-1"
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
                      <ModelMenu
                        label="模型系列"
                        className="h-full"
                        selectedKeys={familyPaneSelectedKeys}
                        onAction={(key) => {
                          const id = String(key);
                          if (id.startsWith('family:')) setActiveFamily(id.slice(7));
                          else pickModel(id);
                        }}
                      >
                        {ungroupedModels.map(modelRow)}
                        {familyGroups.map((group) => (
                          <ModelMenuItem
                            key={group.family}
                            id={`family:${group.family}`}
                            ref={(el) => {
                              if (el) familyItemRefs.current.set(group.family, el);
                              else familyItemRefs.current.delete(group.family);
                            }}
                            textValue={familyLabel(group.family)}
                            shouldCloseOnSelect={false}
                            className={group.family === activeGroup?.family ? 'bg-background-primary-hover' : undefined}
                            onHoverStart={() => setActiveFamily(group.family)}
                            onFocusChange={(focused) => {
                              if (focused) setActiveFamily(group.family);
                            }}
                            trailing={<RiArrowRightSLine aria-hidden="true" className="size-4 shrink-0 text-foreground-icon-secondary" />}
                          >
                            {familyLabel(group.family)}
                          </ModelMenuItem>
                        ))}
                      </ModelMenu>
                    </div>
                    {activeGroup ? (
                      <div
                        data-model-pane="versions"
                        className="min-w-0 flex-1"
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            event.stopPropagation();
                            familyItemRefs.current.get(activeGroup.family)?.focus();
                          }
                        }}
                      >
                        <ModelMenu
                          key={activeGroup.family}
                          label={`${familyLabel(activeGroup.family)} 版本`}
                          className="h-full"
                          selectedKeys={selectedKeys}
                          onAction={selectModel}
                        >
                          {activeGroup.items.map((item) => (
                            <ModelMenuItem key={item.id} id={item.id} textValue={item.displayName}>
                              {item.id === activeGroup.family ? '最新' : item.displayName}
                              {item.id === activeGroup.family && item.description ? (
                                <span className="ms-1.5 text-body-2-regular text-text-secondary">{item.description}</span>
                              ) : null}
                            </ModelMenuItem>
                          ))}
                        </ModelMenu>
                      </div>
                    ) : null}
                  </div>
                )
              )}
            </div>
            </AriaDialog>
          </AriaPopover>
        </AriaDialogTrigger>
      </div>

      {/* Bottom row: stepped effort slider (BoardUI EffortSlider recipe) */}
      {totalSteps > 0 ? (
        <div
          ref={trackRef}
          className={cx(
            'relative h-[27px] w-full cursor-pointer touch-none rounded-lg bg-background-secondary-default select-none',
            'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary-default',
          )}
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
          {/* Fill tinted by the current effort level */}
          <div
            className={cx(
              'composer-model-card__fill pointer-events-none absolute inset-y-0 left-0 rounded-lg bg-(--effort-color)',
              !isDragging && 'transition-[width,background-color,box-shadow] duration-150 ease-out',
            )}
            style={{ width: fillWidthStyle }}
          />

          {/* Tick marks on the stops: under the fill they turn white, past the
              thumb they fade to 30%. */}
          <div className="pointer-events-none absolute inset-0 z-1" aria-hidden="true">
            {supportedReasoningEfforts.map((effort, index) => (
              <span
                key={effort}
                className={cx(
                  'absolute top-[7px] h-[13px] w-[3px] -translate-x-1/2 rounded-[2px] transition-[background-color,opacity] duration-150 ease-out',
                  index < currentIndex ? 'bg-text-white/60' : 'bg-foreground-icon-tertiary',
                  index > currentIndex && 'opacity-30',
                )}
                style={{ left: totalSteps === 1 ? '50%' : stopPosition(index / (totalSteps - 1)) }}
              />
            ))}
          </div>

          {/* Thumb */}
          <div
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute top-0 z-2 h-[27px] w-[21px] -translate-x-1/2 rounded-[7px]',
              'border border-border-checkbox-default bg-background-primary-default shadow-xs',
              !isDragging && 'transition-[left] duration-150 ease-out',
            )}
            style={{ left: totalSteps <= 1 ? '50%' : stopPosition(fraction) }}
          />
        </div>
      ) : (
        <p className="py-1.5 text-center text-caption-1-regular text-text-secondary">
          当前模型不支持调整思考强度
        </p>
      )}
    </div>
  );
}
