"use client";

import { useTemplateCopy } from "@/components/foundations/template-copy/template-copy";

import { motion, useReducedMotion } from "motion/react";

/** Private template illustration. Geometry exported from Figma node 4488:11844. */
export function ProjectBoardEmptyState() {
  const localize = useTemplateCopy();
  const reduceMotion = useReducedMotion();
  const cardDuration = 0.32;
  const linesDuration = 0.32;
  const underneathDelay = 0.25;
  const reveal = (delay: number) => ({
    initial: reduceMotion ? false as const : { opacity: 0, y: -5, scale: 0.85 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: reduceMotion ? 0 : cardDuration, delay: reduceMotion ? 0 : delay, ease: "easeInOut" as const },
    style: { transformBox: "fill-box" as const, transformOrigin: "center" },
  });
  // Keep x fixed so each line grows from its left edge.
  const revealLine = (width: number, index: number) => ({
    initial: reduceMotion ? false as const : { width: 0 },
    animate: { width },
    transition: { duration: reduceMotion ? 0 : linesDuration, delay: reduceMotion ? 0 : cardDuration + index * 0.1, ease: "easeInOut" as const },
  });

  return localize((
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeInOut" }}
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div className="relative h-[146px] w-[170px]" role="status">
        <div
          className="absolute top-[18px] left-[15px] h-[103px] w-[140px] rounded-2-5xl"
          style={{ backgroundColor: "var(--color-project-board-empty-panel)" }}
        />
        <svg
          width="42"
          height="35"
          viewBox="0 0 42 35"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="absolute top-[41px] left-[64px] overflow-visible"
        >
          {/* Keep Figma's back-to-front paint order; reveal the front card first. */}
          <motion.g {...reveal(cardDuration + underneathDelay + 0.15)} data-empty-card="3">
            <rect x="6" y="18" width="30" height="17" rx="3.5" fill="var(--color-project-board-empty-back)" />
          </motion.g>
          <motion.g {...reveal(cardDuration + underneathDelay)} data-empty-card="2">
            <rect x="3" y="12" width="36" height="19" rx="4" fill="var(--color-project-board-empty-middle)" />
          </motion.g>
          <motion.g
            {...reveal(0)}
            initial={reduceMotion ? false : { opacity: 0, y: -5, scale: 0.4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            data-empty-card="1"
          >
            <rect width="42" height="27" rx="5" fill="var(--color-project-board-empty-front)" />
            <motion.rect {...revealLine(14, 0)} opacity="0.4" x="3" y="10" width="14" height="3" rx="1.5" fill="var(--color-project-board-empty-detail)" />
            <rect opacity="0.4" x="35" y="3" width="4" height="4" rx="2" fill="var(--color-project-board-empty-detail)" />
            <motion.rect {...revealLine(31, 1)} opacity="0.4" x="3" y="15" width="31" height="3" rx="1.5" fill="var(--color-project-board-empty-detail)" />
            <motion.rect {...revealLine(31, 2)} opacity="0.4" x="3" y="20" width="31" height="3" rx="1.5" fill="var(--color-project-board-empty-detail)" />
          </motion.g>
        </svg>
        <p className="absolute top-[87px] left-0 w-full text-center text-body-2-medium text-text-tertiary">No issues here</p>
      </div>
    </motion.div>
  ));
}
