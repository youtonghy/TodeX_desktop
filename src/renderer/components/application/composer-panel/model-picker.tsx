"use client";

import { useTemplateCopy } from "@/components/foundations/template-copy/template-copy";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { RiArrowDownSLine, RiSearchLine } from "@remixicon/react";
import { motion } from "motion/react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { EFFORT_LEVELS, EffortSlider } from "@/components/application/ai-chat/ai-chat-menus";
import { RadioDot } from "@/components/base/radio/radio";
import { cx } from "@/utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "@/utils/use-dismiss-on-outside-press";

/**
 * Figma sources: Board UI → "model selector" (node 4433:13541) and "model
 * selector effor dropdown" (node 4433:13097).
 *
 * The Composer Panel's model picker. A 341×282 panel: a scrollable 42px rail
 * of provider marks down the left, and on the right a "Models" header with
 * the Quick Search hint over the chosen provider's lineup as 36px radio rows.
 * Quick Search (or "/") turns the header into a field that filters every
 * lineup at once, results carrying their provider's mark and name. The
 * selected row alone carries the effort chip; pressing it opens a 266px
 * popover with the same six-stop slider the pill composer's model menu uses.
 * Everything non-modal, dismissal restored by hand as elsewhere.
 */

/* --------------------------------------------------------------- catalogue */

export interface ModelOption {
  id: string;
  name: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  /** Monochrome mark (black at 30% as exported); inverted in dark mode. */
  logo: string;
  /** The rail draws the ChatGPT and Claude marks at 18px, the rest at 20px. */
  logoSize?: 18 | 20;
  models: ModelOption[];
}

const LOGOS = "/composer-panel/models";

/** Realistic lineups per provider, most capable first and long enough that every
 *  list scrolls. The first eight carry the marks the design ships; ids are
 *  provider-prefixed so lineups may share names. */
export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    logo: `${LOGOS}/openai.svg`,
    logoSize: 18,
    models: [
      { id: "openai/gpt-5.6-mini", name: "GPT-5.6 Mini" },
      { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
      { id: "openai/gpt-5.5", name: "GPT-5.5" },
      { id: "openai/gpt-5.5-mini", name: "GPT-5.5 Mini" },
      { id: "openai/gpt-5.4", name: "GPT-5.4" },
      { id: "openai/gpt-5.4-mini", name: "GPT-5.4 Mini" },
      { id: "openai/gpt-5.4-nano", name: "GPT-5.4 Nano" },
      { id: "openai/o5", name: "o5" },
      { id: "openai/o5-mini", name: "o5 Mini" },
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    logo: `${LOGOS}/anthropic.svg`,
    logoSize: 18,
    models: [
      { id: "anthropic/fable-5.1", name: "Fable 5.1" },
      { id: "anthropic/fable-5", name: "Fable 5" },
      { id: "anthropic/opus-5", name: "Opus 5" },
      { id: "anthropic/sonnet-5", name: "Sonnet 5" },
      { id: "anthropic/haiku-4.5", name: "Haiku 4.5" },
      { id: "anthropic/opus-4.1", name: "Opus 4.1" },
      { id: "anthropic/sonnet-4.5", name: "Sonnet 4.5" },
      { id: "anthropic/opus-4", name: "Opus 4" },
      { id: "anthropic/sonnet-4", name: "Sonnet 4" },
      { id: "anthropic/haiku-3.5", name: "Haiku 3.5" },
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    logo: `${LOGOS}/perplexity.svg`,
    models: [
      { id: "perplexity/sonar-pro", name: "Sonar Pro" },
      { id: "perplexity/sonar-reasoning-pro", name: "Sonar Reasoning Pro" },
      { id: "perplexity/sonar-reasoning", name: "Sonar Reasoning" },
      { id: "perplexity/sonar-deep-research", name: "Sonar Deep Research" },
      { id: "perplexity/sonar", name: "Sonar" },
      { id: "perplexity/r1-1776", name: "R1 1776" },
      { id: "perplexity/sonar-large", name: "Sonar Large" },
      { id: "perplexity/sonar-small", name: "Sonar Small" },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    logo: `${LOGOS}/cursor.svg`,
    models: [
      { id: "cursor/composer-2.5", name: "Composer 2.5" },
      { id: "cursor/composer-2", name: "Composer 2" },
      { id: "cursor/composer-1.5", name: "Composer 1.5" },
      { id: "cursor/composer-1", name: "Composer 1" },
      { id: "cursor/tab-3", name: "Tab 3" },
      { id: "cursor/tab-2", name: "Tab 2" },
      { id: "cursor/apply-2", name: "Apply 2" },
      { id: "cursor/fast-apply", name: "Fast Apply" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    logo: `${LOGOS}/openrouter.svg`,
    models: [
      { id: "openrouter/auto-router", name: "Auto Router" },
      { id: "openrouter/llama-4-maverick", name: "Llama 4 Maverick" },
      { id: "openrouter/llama-4-scout", name: "Llama 4 Scout" },
      { id: "openrouter/qwen-3.5-coder", name: "Qwen 3.5 Coder" },
      { id: "openrouter/kimi-k2.5", name: "Kimi K2.5" },
      { id: "openrouter/glm-5", name: "GLM 5" },
      { id: "openrouter/deepseek-v4", name: "DeepSeek V4" },
      { id: "openrouter/mistral-large-3", name: "Mistral Large 3" },
      { id: "openrouter/hermes-4", name: "Hermes 4" },
      { id: "openrouter/nemotron-ultra", name: "Nemotron Ultra" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    logo: `${LOGOS}/deepseek.svg`,
    models: [
      { id: "deepseek/deepseek-v4", name: "DeepSeek V4" },
      { id: "deepseek/deepseek-r2", name: "DeepSeek R2" },
      { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2" },
      { id: "deepseek/deepseek-v3.1", name: "DeepSeek V3.1" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
      { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
      { id: "deepseek/deepseek-coder-v3", name: "DeepSeek Coder V3" },
      { id: "deepseek/deepseek-prover-v2", name: "DeepSeek Prover V2" },
      { id: "deepseek/janus-pro", name: "Janus Pro" },
    ],
  },
  {
    id: "jina",
    name: "Jina",
    logo: `${LOGOS}/jina.svg`,
    models: [
      { id: "jina/embeddings-v4", name: "Embeddings v4" },
      { id: "jina/embeddings-v3", name: "Embeddings v3" },
      { id: "jina/reranker-v3", name: "Reranker v3" },
      { id: "jina/reranker-v2", name: "Reranker v2" },
      { id: "jina/clip-v2", name: "CLIP v2" },
      { id: "jina/readerlm-v2", name: "ReaderLM v2" },
      { id: "jina/colbert-v2", name: "ColBERT v2" },
      { id: "jina/segmenter", name: "Segmenter" },
      { id: "jina/classifier", name: "Classifier" },
    ],
  },
  {
    id: "ollama",
    name: "Ollama",
    logo: `${LOGOS}/ollama.svg`,
    models: [
      { id: "ollama/llama-4-scout", name: "Llama 4 Scout" },
      { id: "ollama/gemma-4", name: "Gemma 4" },
      { id: "ollama/qwen-3.5", name: "Qwen 3.5" },
      { id: "ollama/qwen-3.5-coder", name: "Qwen 3.5 Coder" },
      { id: "ollama/phi-5", name: "Phi 5" },
      { id: "ollama/mistral-small-4", name: "Mistral Small 4" },
      { id: "ollama/deepseek-r2", name: "DeepSeek R2" },
      { id: "ollama/gpt-oss-20b", name: "GPT-OSS 20B" },
      { id: "ollama/llama-3.3", name: "Llama 3.3" },
      { id: "ollama/nomic-embed-v2", name: "Nomic Embed v2" },
    ],
  },
  // The marks below come from LobeHub's icon set (lobehub.com/icons),
  // flattened to the same black-at-30% treatment as the Figma exports.
  {
    id: "google",
    name: "Google",
    logo: `${LOGOS}/gemini.svg`,
    models: [
      { id: "google/gemini-3.5-pro", name: "Gemini 3.5 Pro" },
      { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" },
      { id: "google/gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" },
      { id: "google/gemini-3-pro", name: "Gemini 3 Pro" },
      { id: "google/gemini-3-flash", name: "Gemini 3 Flash" },
      { id: "google/gemini-3-flash-lite", name: "Gemini 3 Flash Lite" },
      { id: "google/gemma-4", name: "Gemma 4" },
      { id: "google/gemma-4-nano", name: "Gemma 4 Nano" },
      { id: "google/imagen-5", name: "Imagen 5" },
      { id: "google/veo-4", name: "Veo 4" },
    ],
  },
  {
    id: "meta",
    name: "Meta",
    logo: `${LOGOS}/meta.svg`,
    models: [
      { id: "meta/llama-5", name: "Llama 5" },
      { id: "meta/llama-4-behemoth", name: "Llama 4 Behemoth" },
      { id: "meta/llama-4-maverick", name: "Llama 4 Maverick" },
      { id: "meta/llama-4-scout", name: "Llama 4 Scout" },
      { id: "meta/llama-3.3-70b", name: "Llama 3.3 70B" },
      { id: "meta/llama-3.2-vision", name: "Llama 3.2 Vision" },
      { id: "meta/llama-3.2-3b", name: "Llama 3.2 3B" },
      { id: "meta/code-llama-2", name: "Code Llama 2" },
      { id: "meta/llama-guard-4", name: "Llama Guard 4" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    logo: `${LOGOS}/mistral.svg`,
    models: [
      { id: "mistral/mistral-large-3", name: "Mistral Large 3" },
      { id: "mistral/mistral-medium-3.5", name: "Mistral Medium 3.5" },
      { id: "mistral/magistral-medium", name: "Magistral Medium" },
      { id: "mistral/magistral-small", name: "Magistral Small" },
      { id: "mistral/codestral-2", name: "Codestral 2" },
      { id: "mistral/devstral-2", name: "Devstral 2" },
      { id: "mistral/mistral-small-4", name: "Mistral Small 4" },
      { id: "mistral/ministral-8b", name: "Ministral 8B" },
      { id: "mistral/pixtral-large", name: "Pixtral Large" },
      { id: "mistral/mistral-ocr", name: "Mistral OCR" },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    logo: `${LOGOS}/xai.svg`,
    models: [
      { id: "xai/grok-5", name: "Grok 5" },
      { id: "xai/grok-4.2", name: "Grok 4.2" },
      { id: "xai/grok-4.1", name: "Grok 4.1" },
      { id: "xai/grok-4-fast", name: "Grok 4 Fast" },
      { id: "xai/grok-4-heavy", name: "Grok 4 Heavy" },
      { id: "xai/grok-4", name: "Grok 4" },
      { id: "xai/grok-code-fast", name: "Grok Code Fast" },
      { id: "xai/grok-3", name: "Grok 3" },
      { id: "xai/grok-3-mini", name: "Grok 3 Mini" },
    ],
  },
  {
    id: "qwen",
    name: "Qwen",
    logo: `${LOGOS}/qwen.svg`,
    models: [
      { id: "qwen/qwen-3.5-max", name: "Qwen 3.5 Max" },
      { id: "qwen/qwen-3.5-plus", name: "Qwen 3.5 Plus" },
      { id: "qwen/qwen-3.5-flash", name: "Qwen 3.5 Flash" },
      { id: "qwen/qwen-3.5-coder", name: "Qwen 3.5 Coder" },
      { id: "qwen/qwen-3.5-vl", name: "Qwen 3.5 VL" },
      { id: "qwen/qwen-3-235b", name: "Qwen 3 235B" },
      { id: "qwen/qwen-3-32b", name: "Qwen 3 32B" },
      { id: "qwen/qwen-3-omni", name: "Qwen 3 Omni" },
      { id: "qwen/qwq-32b", name: "QwQ 32B" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    logo: `${LOGOS}/groq.svg`,
    models: [
      { id: "groq/llama-4-scout", name: "Llama 4 Scout" },
      { id: "groq/llama-4-maverick", name: "Llama 4 Maverick" },
      { id: "groq/kimi-k2", name: "Kimi K2" },
      { id: "groq/gpt-oss-120b", name: "GPT-OSS 120B" },
      { id: "groq/gpt-oss-20b", name: "GPT-OSS 20B" },
      { id: "groq/qwen-3-32b", name: "Qwen 3 32B" },
      { id: "groq/llama-3.3-70b", name: "Llama 3.3 70B" },
      { id: "groq/llama-3.1-8b", name: "Llama 3.1 8B" },
      { id: "groq/gemma-2-9b", name: "Gemma 2 9B" },
    ],
  },
  {
    id: "cohere",
    name: "Cohere",
    logo: `${LOGOS}/cohere.svg`,
    models: [
      { id: "cohere/command-a", name: "Command A" },
      { id: "cohere/command-a-reasoning", name: "Command A Reasoning" },
      { id: "cohere/command-a-vision", name: "Command A Vision" },
      { id: "cohere/command-r-plus", name: "Command R+" },
      { id: "cohere/command-r", name: "Command R" },
      { id: "cohere/command-r7b", name: "Command R7B" },
      { id: "cohere/embed-v4", name: "Embed v4" },
      { id: "cohere/rerank-v3.5", name: "Rerank v3.5" },
      { id: "cohere/aya-expanse-32b", name: "Aya Expanse 32B" },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot",
    logo: `${LOGOS}/moonshot.svg`,
    models: [
      { id: "moonshot/kimi-k2.5", name: "Kimi K2.5" },
      { id: "moonshot/kimi-k2-thinking", name: "Kimi K2 Thinking" },
      { id: "moonshot/kimi-k2", name: "Kimi K2" },
      { id: "moonshot/kimi-k1.5", name: "Kimi K1.5" },
      { id: "moonshot/kimi-vl", name: "Kimi VL" },
      { id: "moonshot/kimi-dev-72b", name: "Kimi Dev 72B" },
      { id: "moonshot/moonshot-v1-128k", name: "Moonshot v1 128K" },
      { id: "moonshot/moonshot-v1-32k", name: "Moonshot v1 32K" },
    ],
  },
  {
    id: "zhipu",
    name: "Zhipu",
    logo: `${LOGOS}/zhipu.svg`,
    models: [
      { id: "zhipu/glm-5", name: "GLM 5" },
      { id: "zhipu/glm-4.6", name: "GLM 4.6" },
      { id: "zhipu/glm-4.5", name: "GLM 4.5" },
      { id: "zhipu/glm-4.5-air", name: "GLM 4.5 Air" },
      { id: "zhipu/glm-4.5v", name: "GLM 4.5V" },
      { id: "zhipu/glm-4-plus", name: "GLM 4 Plus" },
      { id: "zhipu/glm-4-flash", name: "GLM 4 Flash" },
      { id: "zhipu/cogview-4", name: "CogView 4" },
      { id: "zhipu/codegeex-4", name: "CodeGeeX 4" },
    ],
  },
  {
    id: "amazon",
    name: "Amazon",
    logo: `${LOGOS}/aws.svg`,
    models: [
      { id: "amazon/nova-premier", name: "Nova Premier" },
      { id: "amazon/nova-pro", name: "Nova Pro" },
      { id: "amazon/nova-lite", name: "Nova Lite" },
      { id: "amazon/nova-micro", name: "Nova Micro" },
      { id: "amazon/nova-canvas", name: "Nova Canvas" },
      { id: "amazon/nova-reel", name: "Nova Reel" },
      { id: "amazon/nova-sonic", name: "Nova Sonic" },
      { id: "amazon/titan-text-premier", name: "Titan Text Premier" },
      { id: "amazon/titan-embed-v2", name: "Titan Embed v2" },
    ],
  },
];

export const DEFAULT_MODEL = "openai/gpt-5.6-mini";
/** "Medium", the design's resting effort. */
export const DEFAULT_EFFORT = 1;

function findModel(providers: ModelProvider[], id: string) {
  for (const provider of providers) {
    const model = provider.models.find((option) => option.id === id);
    if (model) return { provider, model };
  }
  return null;
}

/** Every model whose name, or provider, contains the query; all of them for an
 *  empty query. */
function searchModels(providers: ModelProvider[], query: string) {
  const needle = query.trim().toLowerCase();
  return providers.flatMap((provider) =>
    provider.models
      .filter(
        (model) =>
          !needle ||
          model.name.toLowerCase().includes(needle) ||
          provider.name.toLowerCase().includes(needle),
      )
      .map((model) => ({ provider, model })),
  );
}

/* --------------------------------------------------------------- surfaces */

const POPOVER_MOTION = cx(
  "transition duration-150 ease-out",
  "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
  "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
  "data-[placement=bottom]:origin-top-left rtl:data-[placement=bottom]:origin-top-right data-[placement=top]:origin-bottom-left rtl:data-[placement=top]:origin-bottom-right",
);

/* Both panels open from their trigger's RIGHT edge. The model trigger and
 * the effort chip each sit at the right end of a row, so that edge holds
 * still while a new label changes their width; anchoring there, with a
 * constant offset measured once at open (panel width minus trigger width),
 * keeps the panel's left edge on the trigger's opening left edge without a
 * single repositioning frame. Keep these in step with the w-[...] classes. */
const PICKER_WIDTH = 341;
const EFFORT_WIDTH = 266;

/* Shadow is a raw Figma value: 1px/2px at 4% over 4px/8px at 2%, a touch
 * softer than shadow/dropdown. */
const PICKER_POPOVER = cx(
  "relative h-[282px] w-[341px] max-w-[calc(100vw-32px)] overflow-clip",
  "rounded-[20px] border border-border-button-default bg-background-primary-default",
  "shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.02)]",
  POPOVER_MOTION,
);

const EFFORT_POPOVER = cx(
  "w-[266px] max-w-[calc(100vw-32px)]",
  "rounded-2xl border border-border-button-default bg-background-primary-default p-1 shadow-dropdown",
  POPOVER_MOTION,
);

/* The rail and the list both scroll without a visible scrollbar; the row
 * clipped at the bottom edge is the cue, as in the design. */
const HIDDEN_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/**
 * The soft top edge of a scrolled list: three backdrop blurs of growing
 * strength, each masked shorter than the last so the blur ramps up toward
 * the edge, under a wash of the panel colour. Fades in once the list has
 * scrolled, so the resting state keeps the design's plain top.
 */
function ScrollFade({ visible }: { visible: boolean }) {
  const localize = useTemplateCopy();
  return localize((
    <div
      aria-hidden
      className={cx(
        "pointer-events-none absolute inset-x-0 top-0 z-10 h-8 transition-opacity duration-200 ease-out",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="absolute inset-0 backdrop-blur-[1px] [mask-image:linear-gradient(to_bottom,black_0%,black_45%,transparent_100%)]" />
      <div className="absolute inset-0 backdrop-blur-[3px] [mask-image:linear-gradient(to_bottom,black_0%,black_25%,transparent_75%)]" />
      <div className="absolute inset-0 backdrop-blur-[8px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-linear-to-b from-background-primary-default via-background-primary-default/70 to-transparent" />
    </div>
  ));
}

function ProviderLogo({
  provider,
  size,
  className,
}: {
  provider: ModelProvider;
  size: number;
  className?: string;
}) {
  const localize = useTemplateCopy();
  return localize((
    <img
      src={provider.logo}
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 dark:invert", className)}
      style={{ width: size, height: size }}
      aria-hidden
    />
  ));
}

/* ------------------------------------------------------------ effort menu */

interface EffortMenuProps {
  value: number;
  onChange: (effort: number) => void;
  /** Shared with the picker so a press inside here keeps the picker open. */
  popoverRef: RefObject<HTMLElement | null>;
}

/** The "Medium ›" chip on the selected row and its 266px effort popover. */
function EffortMenu({ value, onChange, popoverRef }: EffortMenuProps) {
  const localize = useTemplateCopy();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef]);
  const allowOpenChange = useTriggerToggle(isOpen, triggerRef);
  // The chip widens with its label ("Medium" to "Very High"); see PICKER_WIDTH.
  const [openWidth, setOpenWidth] = useState(0);
  const level = EFFORT_LEVELS[value] ?? EFFORT_LEVELS[DEFAULT_EFFORT];

  return localize((
    <AriaDialogTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!allowOpenChange(next)) return;
        if (next) setOpenWidth(triggerRef.current?.getBoundingClientRect().width ?? 0);
        setIsOpen(next);
      }}
    >
      <AriaButton
        ref={triggerRef}
        aria-label={`Effort: ${level}`}
        className="flex shrink-0 cursor-pointer items-center rounded-full bg-background-tertiary-default py-1 pe-1 ps-2 outline-none transition-colors duration-150 ease hover:bg-background-tertiary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{level}</span>
        <RiArrowDownSLine
          className={cx(
            "size-[18px] shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease",
            isOpen ? "rotate-0" : "-rotate-90",
          )}
          aria-hidden
        />
      </AriaButton>

      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="bottom end"
        offset={10}
        crossOffset={EFFORT_WIDTH - openWidth}
        className={EFFORT_POPOVER}
      >
        <AriaDialog aria-label="Effort" className="flex flex-col pt-1 outline-none">
          <p className="-mb-0.5 ps-2 text-body-medium text-text-secondary">
            Effort {/* Keyed on the value so each change remounts and blurs in. */}
            <motion.span
              key={level}
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="inline-block text-text-primary"
            >
              {level}
            </motion.span>
          </p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2 pt-2 pb-[3px] text-body-2-medium text-text-secondary">
              <span>Faster</span>
              <span>Smarter</span>
            </div>
            <div className="px-2 pb-2">
              <EffortSlider value={value} onChange={onChange} />
            </div>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  ));
}

/* ------------------------------------------------------------ model picker */

export interface ModelPickerProps {
  /** Controlled model id. Left out, the picker keeps its own. */
  value?: string;
  defaultValue?: string;
  onChange?: (modelId: string) => void;
  /** Controlled effort stop, 0 to 5 across `EFFORT_LEVELS`. */
  effort?: number;
  defaultEffort?: number;
  onEffortChange?: (effort: number) => void;
  providers?: ModelProvider[];
  className?: string;
}

export function ModelPicker({
  value,
  defaultValue = DEFAULT_MODEL,
  onChange,
  effort,
  defaultEffort = DEFAULT_EFFORT,
  onEffortChange,
  providers = MODEL_PROVIDERS,
  className,
}: ModelPickerProps) {
  const localize = useTemplateCopy();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const effortPopoverRef = useRef<HTMLElement>(null);
  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [
    triggerRef,
    popoverRef,
    effortPopoverRef,
  ]);
  const allowOpenChange = useTriggerToggle(isOpen, triggerRef);
  // Picking a model relabels the trigger, which sits right-aligned; see PICKER_WIDTH.
  const [openWidth, setOpenWidth] = useState(0);

  const [internalModel, setInternalModel] = useState(defaultValue);
  const [internalEffort, setInternalEffort] = useState(defaultEffort);
  const modelId = value ?? internalModel;
  const effortValue = effort ?? internalEffort;
  const selected = findModel(providers, modelId) ?? {
    provider: providers[0],
    model: providers[0]?.models[0],
  };

  // The rail browses; it starts on the chosen model's provider each time.
  const [browsing, setBrowsing] = useState<string | null>(null);
  const activeProvider =
    providers.find((provider) => provider.id === browsing) ?? selected.provider;

  // Quick Search: null when the header shows the hint, the query otherwise.
  const [query, setQuery] = useState<string | null>(null);
  const searching = query !== null;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);
  const results = searching ? searchModels(providers, query) : null;

  // "/" or ⌘K anywhere in the panel reaches the field. Listened on the
  // popover element itself: React Aria focuses the dialog, and keys landing
  // there never pass through a handler nested inside it.
  useEffect(() => {
    if (!isOpen || searching) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).tagName === "INPUT") return;
      const shortcut =
        event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");
      if (!shortcut) return;
      event.preventDefault();
      setQuery("");
    };
    popover.addEventListener("keydown", onKeyDown);
    return () => popover.removeEventListener("keydown", onKeyDown);
  }, [isOpen, searching]);

  // The rail keeps the active provider's mark in view: instantly when the
  // panel opens, smoothly when a pick from search or a rail press lands on a
  // mark outside the visible run. A mark already in view is left alone.
  const railRef = useRef<HTMLDivElement>(null);
  const railShownRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      railShownRef.current = false;
      return;
    }
    const rail = railRef.current;
    const mark = rail?.querySelector<HTMLElement>(`[data-provider="${activeProvider.id}"]`);
    if (!rail || !mark) return;
    const firstPaint = !railShownRef.current;
    railShownRef.current = true;
    const top = mark.offsetTop;
    const bottom = top + mark.offsetHeight;
    const inView = top >= rail.scrollTop && bottom <= rail.scrollTop + rail.clientHeight;
    if (!firstPaint && inView) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({
      top: Math.max(0, top - (rail.clientHeight - mark.offsetHeight) / 2),
      behavior: firstPaint || reduceMotion ? "instant" : "smooth",
    });
  }, [isOpen, activeProvider.id]);

  // The list's top edge softens once it has scrolled; a new lineup starts
  // at the top again.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const listKey = searching ? "search" : activeProvider.id;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setScrolled(false);
  }
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [listKey]);

  const selectModel = (id: string) => {
    setInternalModel(id);
    onChange?.(id);
  };
  const changeEffort = (next: number) => {
    setInternalEffort(next);
    onEffortChange?.(next);
  };

  return localize((
    <AriaDialogTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        if (!allowOpenChange(next)) return;
        if (next) {
          setBrowsing(null);
          setOpenWidth(triggerRef.current?.getBoundingClientRect().width ?? 0);
        }
        setQuery(null);
        setIsOpen(next);
      }}
    >
      <AriaButton
        ref={triggerRef}
        className={cx(
          "flex h-8 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-xl bg-background-primary-default py-1.5 pe-1 ps-2 outline-none transition-colors duration-150 ease hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          className,
        )}
      >
        <span className="px-0.5 text-body-medium whitespace-nowrap text-text-secondary">
          {selected.model?.name}
        </span>
        <RiArrowDownSLine
          className={cx(
            "size-[18px] shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease",
            isOpen && "rotate-180",
          )}
          aria-hidden
        />
      </AriaButton>

      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="top end"
        offset={8}
        crossOffset={PICKER_WIDTH - openWidth}
        className={PICKER_POPOVER}
      >
        <AriaDialog aria-label="Models" className="size-full outline-none">
          <div className="size-full">
            {/* Provider rail: 42px wide, 3px in from the panel's edge top, left
              and bottom (2px inside its border), marks 36×30 six apart. */}
            <div
              ref={railRef}
              role="tablist"
              aria-label="Providers"
              aria-orientation="vertical"
              className={cx(
                "absolute top-0.5 start-0.5 h-[276px] w-[42px] overflow-y-auto rounded-[17px] bg-composer-panel-rail-background p-[3px]",
                HIDDEN_SCROLLBAR,
              )}
            >
              <div className="flex w-9 flex-col gap-1.5">
                {providers.map((provider) => {
                  const active = provider.id === activeProvider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={provider.name}
                      data-provider={provider.id}
                      title={provider.name}
                      onClick={() => {
                        setBrowsing(provider.id);
                        setQuery(null);
                      }}
                      className={cx(
                        "flex h-[30px] w-9 shrink-0 cursor-pointer items-center justify-center rounded-[50px] outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                        active
                          ? "bg-background-tertiary-default"
                          : "hover:bg-background-tertiary-default/50",
                      )}
                    >
                      <ProviderLogo provider={provider} size={provider.logoSize ?? 20} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Header and the active provider's lineup. */}
            <div className="absolute top-2 end-2 bottom-0 start-[52px] flex flex-col">
              <div className="flex h-5 items-center justify-between gap-[5px] px-0.5">
                {searching ? (
                  <>
                    <input
                      ref={searchRef}
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        // First Escape clears, the next leaves search; neither
                        // reaches the popover, which would close on it.
                        event.preventDefault();
                        event.stopPropagation();
                        setQuery(query ? "" : null);
                      }}
                      onBlur={() => {
                        if (!query) setQuery(null);
                      }}
                      placeholder="Search models"
                      aria-label="Search models"
                      className="h-5 min-w-0 flex-1 bg-transparent text-body-medium text-text-primary caret-accent-500 outline-none placeholder:text-text-tertiary"
                    />
                    <button
                      type="button"
                      aria-label="Close search"
                      onClick={() => setQuery(null)}
                      className="flex shrink-0 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                    >
                      <RiSearchLine
                        className="size-4 shrink-0 text-foreground-icon-secondary"
                        aria-hidden
                      />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-body-medium text-text-tertiary">Models</span>
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="flex cursor-pointer items-center gap-[5px] rounded-sm opacity-50 outline-none transition-opacity duration-150 ease hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                    >
                      <span className="text-body-medium whitespace-nowrap text-text-secondary">
                        Quick Search
                      </span>
                      <RiSearchLine
                        className="size-4 shrink-0 text-foreground-icon-secondary"
                        aria-hidden
                      />
                    </button>
                  </>
                )}
              </div>

              <div className="relative mt-1 flex min-h-0 flex-1 flex-col">
                <ScrollFade visible={scrolled} />
                <div
                  ref={listRef}
                  role="radiogroup"
                  aria-label={searching ? "Matching models" : `${activeProvider.name} models`}
                  onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
                  className={cx(
                    "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-1",
                    HIDDEN_SCROLLBAR,
                  )}
                >
                  {results && results.length === 0 && (
                    <p className="px-2 py-2 text-body-medium text-text-tertiary">No models match</p>
                  )}
                  {(
                    results ??
                    activeProvider.models.map((model) => ({
                      provider: activeProvider,
                      model,
                    }))
                  ).map(({ provider, model }) => {
                    const checked = model.id === modelId;
                    return (
                      <div
                        key={model.id}
                        className={cx(
                          "relative flex h-9 w-full shrink-0 items-center rounded-2lg px-2 transition-colors",
                          checked
                            ? "bg-background-primary-hover"
                            : "hover:bg-background-primary-hover",
                        )}
                      >
                        {/* The whole row selects; the chip sits above it. */}
                        <button
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          aria-label={`${provider.name} ${model.name}`}
                          onClick={() => {
                            selectModel(model.id);
                            // A pick from search lands on that provider's lineup.
                            if (searching) {
                              setBrowsing(provider.id);
                              setQuery(null);
                            }
                          }}
                          className="absolute inset-0 cursor-pointer rounded-2lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
                        />
                        <span className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <ProviderLogo provider={provider} size={16} />
                            <span className="min-w-0 flex-1 truncate text-body-medium whitespace-nowrap">
                              <span className="text-text-primary">{model.name}</span>
                              {searching && (
                                <span className="ms-1.5 text-text-tertiary">{provider.name}</span>
                              )}
                            </span>
                            {checked && (
                              <span className="pointer-events-auto flex shrink-0">
                                <EffortMenu
                                  value={effortValue}
                                  onChange={changeEffort}
                                  popoverRef={effortPopoverRef}
                                />
                              </span>
                            )}
                          </span>
                          <RadioDot size="sm" selected={checked} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  ));
}
