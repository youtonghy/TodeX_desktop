"use client";

import { useTemplateCopy } from "@/components/foundations/template-copy/template-copy";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  RiArrowUpLine,
  RiFolder2Line,
  RiGitMergeLine,
  RiMic2Line,
  RiRouteLine,
  RiShieldCheckLine,
  RiSpeedUpFill,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { AddMenu } from "@/components/application/ai-chat/ai-chat-menus";
import {
  ModelPicker,
  type ModelProvider,
} from "@/components/application/composer-panel/model-picker";
import { CloseButton } from "@/components/base/buttons/close-button";
import { LinkButton } from "@/components/base/buttons/link-button";
import { cx } from "@/utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "@/utils/use-dismiss-on-outside-press";

/**
 * Figma sources: Board UI → "new composer with permissions dropdown"
 * (node 4430:12203) and "new composer with attachments" (node 4430:12544).
 *
 * The two-row composer. A radius-24 white card carries the prompt on its
 * first row and the controls on its second: the add menu, the permission
 * picker, the model picker (model-picker.tsx, with its provider rail and
 * effort popover), mic and send. The status tab (branch, project
 * folder, context meter) is a grey tab hanging off the card's top edge rather
 * than a row underneath. Attachments ride a strip of 56px tiles above the
 * prompt, each drawing the upload ring while its file lands.
 *
 * The single-line pill (`Composer` in ai-chat-composer.tsx) stays as it is;
 * this is a separate block for surfaces that want the taller layout and the
 * permission modes. `ComposerWithAttachments` (composer-attachments.tsx)
 * adds the sequential upload queue on top.
 */

/* ------------------------------------------------------------- permissions */

export type ComposerPermission = "auto" | "manual" | "plan" | "bypass";

export interface ComposerPermissionOption {
  id: ComposerPermission;
  label: string;
  description: string;
  icon: typeof RiSpeedUpFill;
  /** Figma draws the branch and route glyphs mirrored on the vertical axis. */
  flip?: boolean;
}

export const COMPOSER_PERMISSIONS: ComposerPermissionOption[] = [
  { id: "auto", label: "Auto", description: "Agent decides by itself", icon: RiSpeedUpFill },
  {
    id: "manual",
    label: "Manual",
    description: "Always ask before making a change",
    icon: RiGitMergeLine,
    flip: true,
  },
  {
    id: "plan",
    label: "Plan mode",
    description: "Create a plan before proceeding",
    icon: RiRouteLine,
    flip: true,
  },
  {
    id: "bypass",
    label: "Bypass all",
    description: "Agent handles permission decisions",
    icon: RiShieldCheckLine,
  },
];

/* Non-modal like every other composer menu: React Aria's popovers lock page
 * scroll by default, and the reflow that causes shunts the docs' sticky
 * sidebar the moment a menu opens. Non-modal also switches off React Aria's
 * outside-press dismissal, so the menu restores it with
 * useDismissOnOutsidePress, the same fix as Select and Dropdown. */
const PERMISSION_POPOVER = cx(
  "w-[323px] max-w-[calc(100vw-32px)]",
  "rounded-[20px] border border-border-button-default bg-background-primary-default p-1.5 shadow-dropdown",
  "transition duration-150 ease-out",
  "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
  "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
  "data-[placement=bottom]:origin-top-left rtl:data-[placement=bottom]:origin-top-right data-[placement=top]:origin-bottom-left rtl:data-[placement=top]:origin-bottom-right",
);

export interface PermissionMenuProps {
  /** Controlled mode. Left out, the picker keeps its own selection. */
  value?: ComposerPermission;
  defaultValue?: ComposerPermission;
  onChange?: (permission: ComposerPermission) => void;
  /** Where the panel's "Learn more" link button goes. */
  learnMoreHref?: string;
  /** Handler for "Learn more" when it is a button rather than a link. */
  onLearnMore?: () => void;
  className?: string;
}

/* The Link Button's secondary tone is text-secondary; the Figma header sits
 * a step lighter, so the resting colour is tertiary and the hover underline
 * stays the cue. */
const LEARN_MORE = "shrink-0 text-text-tertiary";

/**
 * The permission picker: a pill that only paints its surface on hover, press,
 * or while its menu is open, and a 323px panel with the four modes that
 * opens upward like the add and model menus. Auto is the default.
 */
export function PermissionMenu({
  value,
  defaultValue = "auto",
  onChange,
  learnMoreHref,
  onLearnMore,
  className,
}: PermissionMenuProps) {
  const localize = useTemplateCopy();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef]);
  // Pressing the trigger while open closes the menu instead of reopening it.
  const allowOpenChange = useTriggerToggle(isOpen, triggerRef);
  const [internal, setInternal] = useState<ComposerPermission>(defaultValue);
  const selected = value ?? internal;
  const current =
    COMPOSER_PERMISSIONS.find((option) => option.id === selected) ?? COMPOSER_PERMISSIONS[0];
  const CurrentIcon = current.icon;

  const select = (next: ComposerPermission) => {
    setInternal(next);
    onChange?.(next);
    setIsOpen(false);
  };

  return localize((
    <AriaDialogTrigger
      isOpen={isOpen}
      onOpenChange={(next) => allowOpenChange(next) && setIsOpen(next)}
    >
      <AriaButton
        ref={triggerRef}
        aria-label={`Permission: ${current.label}`}
        className={({ isHovered, isPressed, isFocusVisible }) =>
          cx(
            "flex h-[30px] shrink-0 cursor-pointer items-center gap-1 rounded-full py-[5px] pe-2.5 ps-2 outline-none transition-colors duration-150 ease",
            // Same surface as the model picker's hover: the Figma neutral-100 in
            // light, and a step lighter than the card in dark rather than darker.
            (isHovered || isPressed || isOpen) && "bg-background-primary-hover",
            isFocusVisible && "ring-2 ring-border-focus-ring",
            className,
          )
        }
      >
        <CurrentIcon
          className={cx(
            "size-4 shrink-0 text-foreground-icon-secondary",
            current.flip && "-scale-y-100",
          )}
          aria-hidden
        />
        <span className="text-body-medium whitespace-nowrap text-text-secondary">{current.label}</span>
      </AriaButton>

      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="top start"
        offset={8}
        className={PERMISSION_POPOVER}
      >
        <AriaDialog aria-label="Permissions" className="flex flex-col gap-1.5 pt-1 outline-none">
          <div className="flex items-center gap-2.5 px-2 text-body-medium text-text-tertiary">
            <span className="min-w-0 flex-1">Permissions</span>
            {learnMoreHref ? (
              <LinkButton
                variant="secondary"
                size="small"
                href={learnMoreHref}
                target="_blank"
                rel="noreferrer"
                className={LEARN_MORE}
              >
                Learn more
              </LinkButton>
            ) : (
              <LinkButton variant="secondary" size="small" onClick={onLearnMore} className={LEARN_MORE}>
                Learn more
              </LinkButton>
            )}
          </div>
          <div role="radiogroup" aria-label="Permission mode" className="flex flex-col gap-1">
            {COMPOSER_PERMISSIONS.map((option) => {
              const Icon = option.icon;
              const checked = option.id === selected;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => select(option.id)}
                  className={cx(
                    "flex w-full cursor-pointer items-center gap-2 rounded-[14px] p-2 text-start outline-none transition-colors",
                    checked
                      ? "bg-background-primary-hover"
                      : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
                  )}
                >
                  <Icon
                    className={cx(
                      "size-5 shrink-0 text-foreground-icon-secondary",
                      option.flip && "-scale-y-100",
                    )}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-medium text-text-secondary">
                      {option.label}
                    </span>
                    <span className="truncate text-body-2-medium text-text-tertiary">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  ));
}

/* -------------------------------------------------------------- status tab */

/** 16px circular context meter at `pct` percent. */
function ContextRing({ pct }: { pct: number }) {
  const localize = useTemplateCopy();
  const r = 6;
  const c = 2 * Math.PI * r;
  return localize((
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--color-neutral-300)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--color-neutral-500)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
      />
    </svg>
  ));
}

function StatusItem({ icon, label }: { icon: ReactNode; label: string }) {
  const localize = useTemplateCopy();
  return localize((
    <span className="flex min-w-0 items-center gap-1">
      {icon}
      <span className="truncate text-body-2-medium whitespace-nowrap text-text-secondary">
        {label}
      </span>
    </span>
  ));
}

export interface ComposerStatusTabProps {
  branch?: string;
  project?: string;
  /** Context window used, in percent. */
  context?: number;
  className?: string;
}

/**
 * The grey tab on the card's top edge: 34px tall, inset 28px on each side,
 * rounded 16 at the top only. Branch and project folder on the left, the
 * context meter on the right.
 */
export function ComposerStatusTab({
  branch = "Main",
  project = "project-sea",
  context = 57,
  className,
}: ComposerStatusTabProps) {
  const localize = useTemplateCopy();
  return localize((
    <div
      className={cx(
        "mx-7 flex h-[34px] items-center justify-between gap-3 rounded-t-2xl bg-composer-panel-tab-background px-2 py-1",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <StatusItem
          icon={
            <RiGitMergeLine
              className="size-4 shrink-0 -scale-y-100 text-foreground-icon-secondary"
              aria-hidden
            />
          }
          label={branch}
        />
        <StatusItem
          icon={<RiFolder2Line className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />}
          label={project}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1 rounded-[40px] py-1 pe-2 ps-1.5">
        <ContextRing pct={context} />
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{context}%</span>
      </div>
    </div>
  ));
}

/* ------------------------------------------------------------- attachments */

export type ComposerAttachmentKind =
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "code"
  | "video";

export interface ComposerAttachment {
  id: string;
  name: string;
  kind: ComposerAttachmentKind;
  /** Thumbnail for image tiles. */
  src?: string;
  /**
   * 0–100 draws the upload ring around the tile (the closed ring at 100);
   * leave it out once the file has landed, which also reveals the dismiss.
   */
  progress?: number;
}

/** The plugin document icons the add menu already ships (public/ai-chat). */
const ATTACHMENT_ICONS: Record<
  Exclude<ComposerAttachmentKind, "image">,
  { src: string; darkSrc?: string }
> = {
  document: { src: "/ai-chat/plugin-documents.svg", darkSrc: "/ai-chat/plugin-documents-dark.svg" },
  spreadsheet: { src: "/ai-chat/plugin-spreadsheets.svg" },
  presentation: { src: "/ai-chat/plugin-presentations.svg" },
  code: { src: "/ai-chat/plugin-codeblocks.svg" },
  video: { src: "/ai-chat/plugin-videos.svg" },
};

const TILE = 56;

/** Rounded-rect progress path beginning at top-center and running clockwise,
 *  the same trace the File Upload block draws around its drop zone. */
function ringPath(width: number, height: number, inset: number, radius: number) {
  const x0 = inset;
  const y0 = inset;
  const x1 = width - inset;
  const y1 = height - inset;
  const arc = (endX: number, endY: number) => `A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;

  return [
    `M ${width / 2} ${y0}`,
    `H ${x1 - radius}`,
    arc(x1, y0 + radius),
    `V ${y1 - radius}`,
    arc(x1 - radius, y1),
    `H ${x0 + radius}`,
    arc(x0, y1 - radius),
    `V ${y0 + radius}`,
    arc(x0 + radius, y0),
    "Z",
  ].join(" ");
}

/* Centered on the tile's 1px border: a 2px stroke at inset 1 covers the
 * border and one pixel inside it, on the 12px radius (11 at that inset). */
const TILE_RING = ringPath(TILE, TILE, 1, 11);

export interface ComposerAttachmentTileProps {
  attachment: ComposerAttachment;
  /** Renders the dismiss in the top-right corner once the file has landed. */
  onRemove?: () => void;
  className?: string;
}

/**
 * One 56px tile: the thumbnail for images, otherwise the 24px plugin icon
 * with the file name in 9px underneath. While `progress` is set the content
 * dims, the accent ring draws clockwise from the top, and a 9px percentage
 * (accent, white over a photo) sits top right on the icon's row; at 100 the
 * percentage blurs out as the dismiss blurs in on the same spot.
 */
export function ComposerAttachmentTile({
  attachment,
  onRemove,
  className,
}: ComposerAttachmentTileProps) {
  const localize = useTemplateCopy();
  const { progress } = attachment;
  const inFlight = progress !== undefined;
  const image = attachment.kind === "image" ? attachment.src : undefined;
  const icon = attachment.kind === "image" ? undefined : ATTACHMENT_ICONS[attachment.kind];

  return localize((
    <div
      title={attachment.name}
      className={cx(
        "relative size-14 shrink-0 rounded-xl border border-composer-panel-tile-border",
        className,
      )}
    >
      {image ? (
        <img
          src={image}
          alt={attachment.name}
          className={cx(
            "absolute inset-0 size-full rounded-[11px] object-cover transition-opacity duration-300 ease-out",
            inFlight && "opacity-60",
          )}
        />
      ) : (
        <div className={cx("transition-opacity duration-300 ease-out", inFlight && "opacity-60")}>
          {icon && (
            <>
              <img
                src={icon.src}
                alt=""
                width={24}
                height={24}
                className={cx("absolute top-1 start-[3px] size-6", icon.darkSrc && "theme-asset-light")}
                aria-hidden
              />
              {icon.darkSrc && (
                <img
                  src={icon.darkSrc}
                  alt=""
                  width={24}
                  height={24}
                  className="theme-asset-dark absolute top-1 start-[3px] size-6"
                  aria-hidden
                />
              )}
            </>
          )}
          <span className="absolute top-9 start-1.5 max-w-[44px] truncate text-[9px] leading-[15px] font-medium tracking-[0.2px] text-text-secondary">
            {attachment.name}
          </span>
        </div>
      )}

      {/* Upload ring, over the border (the svg spans the border box). */}
      <svg
        aria-hidden
        viewBox={`0 0 ${TILE} ${TILE}`}
        className={cx(
          "pointer-events-none absolute -inset-px size-14 transition-opacity duration-300 ease-out",
          inFlight ? "opacity-100" : "opacity-0",
        )}
      >
        <path
          d={TILE_RING}
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth={2}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${inFlight ? (progress >= 100 ? 102 : progress) : 102} 200`}
          className="transition-[stroke-dasharray] duration-200 ease-linear"
        />
      </svg>

      {/* Upload percentage on the dismiss's spot: same row as the icon,
          right-aligned to the dismiss's outer edge, on a 16px line so it
          centres on the dismiss. 9px has no type token, so it is spelled
          out; white over a photo, accent over the plain tile. */}
      <span
        aria-hidden
        className={cx(
          "absolute top-[3px] end-[3px] text-[9px] leading-4 font-medium tabular-nums",
          image ? "text-white" : "text-accent-500",
          "transition-[opacity,filter] duration-300 ease-out",
          inFlight ? "opacity-100 blur-[0px]" : "pointer-events-none opacity-0 blur-[3px]",
        )}
      >
        {inFlight ? progress : 100}%
      </span>

      {onRemove && (
        <CloseButton
          size="2xs"
          aria-label={`Remove ${attachment.name}`}
          onClick={onRemove}
          className={cx(
            "absolute top-[3px] start-[35px] transition-[opacity,filter,color] duration-300 ease-out",
            inFlight ? "pointer-events-none opacity-0 blur-[3px]" : "opacity-100 blur-[0px]",
            image
              ? "bg-white/50 text-white backdrop-blur-[2px] hover:text-white"
              : "bg-background-tertiary-default/50",
          )}
        />
      )}
    </div>
  ));
}

export interface ComposerAttachmentStripProps {
  attachments: ComposerAttachment[];
  onRemove?: (id: string) => void;
  className?: string;
}

/** The tile row, 8px apart, wrapping when it runs out of width. Tiles scale
 *  and blur in as they arrive and out again when dismissed. */
export function ComposerAttachmentStrip({
  attachments,
  onRemove,
  className,
}: ComposerAttachmentStripProps) {
  const localize = useTemplateCopy();
  return localize((
    <div className={cx("flex flex-wrap items-start gap-2", className)}>
      <AnimatePresence>
        {attachments.map((attachment) => (
          <motion.div
            key={attachment.id}
            layout
            initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <ComposerAttachmentTile
              attachment={attachment}
              onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ));
}

/* ---------------------------------------------------------------- controls */

/** The listening equalizer: staggered clocks and heights so the bars read
 *  as live audio rather than a synchronized loop. */
const MIC_BARS = [
  { height: 8, duration: "0.9s", delay: "-0.4s" },
  { height: 15, duration: "0.7s", delay: "-0.15s" },
  { height: 11, duration: "1.05s", delay: "-0.6s" },
  { height: 14, duration: "0.8s", delay: "-0.3s" },
];

/* The mic and the bars trade places through a soft crossfade: whichever
 * leaves blurs out while shrinking to 0.8, whichever arrives blurs in while
 * growing from 0.8, both centred on the same spot. */
const MIC_SWAP = {
  initial: { opacity: 0, scale: 0.8, filter: "blur(3px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.8, filter: "blur(3px)" },
  transition: { duration: 0.28, ease: "easeOut" as const },
};

/** Voice input: the mic swaps to dancing equalizer bars until clicked again. */
function MicButton() {
  const localize = useTemplateCopy();
  const [listening, setListening] = useState(false);
  return localize((
    <button
      type="button"
      aria-label="Voice input"
      aria-pressed={listening}
      onClick={() => setListening((on) => !on)}
      className="relative flex size-9 cursor-pointer items-center justify-center rounded-full border border-border-button-default bg-background-primary-default p-2 shadow-xs transition-colors duration-150 ease outline-none hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      <AnimatePresence initial={false}>
        {listening ? (
          <motion.span
            key="bars"
            aria-hidden
            {...MIC_SWAP}
            className="absolute inset-0 flex items-center justify-center gap-[2.5px]"
          >
            {MIC_BARS.map((bar, i) => (
              <span
                key={i}
                className="bui-composer-mic-bar w-[2.5px] rounded-full bg-accent-500"
                style={{
                  height: bar.height,
                  animationDuration: bar.duration,
                  animationDelay: bar.delay,
                }}
              />
            ))}
          </motion.span>
        ) : (
          <motion.span
            key="mic"
            {...MIC_SWAP}
            className="absolute inset-0 flex items-center justify-center"
          >
            <RiMic2Line className="size-5 text-foreground-icon-primary" aria-hidden />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  ));
}

/* ------------------------------------------------------------------- panel */

export interface ComposerPanelProps {
  className?: string;
  /** Style the card surface, including its radius when nested in another panel. */
  cardClassName?: string;
  /** Controlled draft. Left out, the field manages its own text. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Fires on the send button and on Enter (Shift+Enter breaks the line). */
  onSubmit?: (value: string) => void;
  /** Greys out send while a turn is in flight. */
  disabled?: boolean;
  placeholder?: string;
  /** Controlled permission mode; see `PermissionMenu`. */
  permission?: ComposerPermission;
  /** Starting mode when uncontrolled. Auto by default. */
  defaultPermission?: ComposerPermission;
  onPermissionChange?: (permission: ComposerPermission) => void;
  learnMoreHref?: string;
  onLearnMore?: () => void;
  /** Controlled model id; see `ModelPicker` and `MODEL_PROVIDERS`. */
  model?: string;
  defaultModel?: string;
  onModelChange?: (modelId: string) => void;
  /** Controlled effort stop, 0 to 5. */
  effort?: number;
  defaultEffort?: number;
  onEffortChange?: (effort: number) => void;
  /** Your own catalogue for the picker's rail and rows. */
  providers?: ModelProvider[];
  /** Tiles above the prompt. Each one's `progress` drives its upload ring. */
  attachments?: ComposerAttachment[];
  onRemoveAttachment?: (id: string) => void;
  /**
   * The tab on the card's top edge. Defaults to `ComposerStatusTab`; pass
   * your own, or `null` to drop it.
   */
  status?: ReactNode;
  /** The field itself, for focus or a scripted demo. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function ComposerPanel({
  className,
  cardClassName,
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  placeholder = "Hi, what do you need today?",
  permission,
  defaultPermission,
  onPermissionChange,
  learnMoreHref,
  onLearnMore,
  model,
  defaultModel,
  onModelChange,
  effort,
  defaultEffort,
  onEffortChange,
  providers,
  attachments,
  onRemoveAttachment,
  status,
  inputRef,
}: ComposerPanelProps = {}) {
  const localize = useTemplateCopy();
  const [internal, setInternal] = useState("");
  const text = value ?? internal;
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const setFieldRef = (node: HTMLTextAreaElement | null) => {
    fieldRef.current = node;
    if (inputRef) inputRef.current = node;
  };

  // The prompt grows with its text, one 20px line at a time, up to ten
  // lines before it scrolls. Measured from zero so it also shrinks back.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${field.scrollHeight}px`;
  }, [text]);

  const submit = () => {
    if (disabled) return;
    onSubmit?.(text);
    if (value === undefined) setInternal("");
  };

  const hasAttachments = !!attachments && attachments.length > 0;

  return localize((
    <div className={cx("flex w-full flex-col", className)}>
      {status === undefined ? <ComposerStatusTab /> : status}

      {/* Shadow is a raw Figma value with no token yet: two 2% layers, 1px and 4px. */}
      <div className={cx("flex w-full flex-col rounded-3xl bg-background-primary-default p-2.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.02),0_4px_2px_rgba(0,0,0,0.02)]", cardClassName)}>
        {/* The strip collapses with its own 4px foot: with the prompt's 6px
            top padding that is the 10px the design leaves under the tiles,
            and with no tiles the prompt sits at the 16px inset on its own. */}
        <AnimatePresence initial={false}>
          {hasAttachments && (
            <motion.div
              key="attachments"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <ComposerAttachmentStrip
                attachments={attachments}
                onRemove={onRemoveAttachment}
                className="pb-1"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-5 pt-1.5">
          <div className="px-1.5">
            <textarea
              ref={setFieldRef}
              rows={1}
              aria-label="Message"
              value={text}
              onChange={(event) => {
                setInternal(event.target.value);
                onValueChange?.(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
              }}
              placeholder={placeholder}
              className="block max-h-[200px] w-full resize-none bg-transparent p-0 text-body-regular text-text-primary caret-accent-500 outline-none placeholder:text-text-tertiary"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <AddMenu triggerSurface="bg-composer-panel-add-background hover:bg-composer-panel-add-hover-background" />
              <PermissionMenu
                value={permission}
                defaultValue={defaultPermission}
                onChange={onPermissionChange}
                learnMoreHref={learnMoreHref}
                onLearnMore={onLearnMore}
              />
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <ModelPicker
                value={model}
                defaultValue={defaultModel}
                onChange={onModelChange}
                effort={effort}
                defaultEffort={defaultEffort}
                onEffortChange={onEffortChange}
                providers={providers}
              />
              <div className="flex items-center gap-2">
                <MicButton />
                <button
                  type="button"
                  aria-label="Send message"
                  disabled={disabled}
                  onClick={submit}
                  className={cx(
                    "flex size-9 cursor-pointer items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
                    disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <RiArrowUpLine className="size-5 text-white" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ));
}
