"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import styles from "./create-ticket-modal.module.css";

// A smooth, steep center gradient creates a narrow neck with a displacement
// no larger than the dialog width. Its cubic mask leaves the top broad while
// the bottom contracts. The field is static, decoded once per mounted dialog.
const FIELD_STOPS = Array.from({ length: 33 }, (_, index) => {
  const x = index / 32;
  const red = 127.5 * (1 + Math.tanh((x - 0.5) * 16) / Math.tanh(8));
  return `<stop offset="${x}" stop-color="rgb(${red},128,128)"/>`;
}).join("");
const CURVE_STOPS = Array.from({ length: 33 }, (_, index) => {
  const y = index / 32;
  return `<stop offset="${y}" stop-color="white" stop-opacity="${y ** 3}"/>`;
}).join("");

function smoothStep(start: number, end: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

const WARP_MAP = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="280" viewBox="0 0 560 280">
<defs>
  <linearGradient id="field">${FIELD_STOPS}</linearGradient>
  <linearGradient id="curve" x1="0" y1="0" x2="0" y2="1">${CURVE_STOPS}</linearGradient>
  <mask id="bend"><rect width="560" height="280" fill="url(#curve)"/></mask>
</defs>
<rect width="560" height="280" fill="rgb(128,128,128)"/>
<rect width="560" height="280" fill="url(#field)" mask="url(#bend)"/>
</svg>`)}`;

/** Warp the actual dialog pixels, including its content, during entry/exit. */
export function TicketGenieSurface({ exiting, children }: { exiting: boolean; children: ReactNode }) {
  const id = `ticket-genie-${useId().replaceAll(":", "")}`;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement>(null);
  const mapRef = useRef<SVGFEImageElement>(null);
  const progressRef = useRef(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const surface = surfaceRef.current;
    const shadow = shadowRef.current;
    const displacement = displacementRef.current;
    if (!surface || !shadow || !displacement) return;
    if (reduceMotion) {
      surface.style.willChange = "auto";
      shadow.style.willChange = "auto";
      surface.style.filter = "none";
      surface.style.transform = "none";
      surface.style.opacity = "1";
      shadow.style.transform = "none";
      shadow.style.opacity = "1";
      progressRef.current = 0;
      return;
    }
    // SVG percentages otherwise resolve against the page viewport for an HTML
    // filter. Fit the displacement field to the dialog's untransformed pixels.
    const width = surface.offsetWidth;
    const height = surface.offsetHeight;
    mapRef.current?.setAttribute("width", String(width));
    mapRef.current?.setAttribute("height", String(height));
    // Reach just beyond the viewport. All geometry is measured once; each
    // frame only updates filter attributes and compositor transforms.
    const bounds = surface.parentElement!.getBoundingClientRect();
    const dockDistance = Math.max(0, window.innerHeight - bounds.bottom) + 24;
    surface.style.filter = `url("#${id}")`;
    surface.style.willChange = "transform, opacity";
    shadow.style.willChange = "transform, opacity";
    const deform = (progress: number) => {
      progressRef.current = progress;
      const neck = smoothStep(0, 0.72, progress);
      const extension = dockDistance * smoothStep(0, 0.42, progress);
      const swallow = smoothStep(0.32, 1, progress);
      // The bottom leads, stretching into a funnel while the top stays put.
      // Only then does the top follow the neck down into the offscreen dock.
      const stretch = Math.max(0.001, ((height + extension) * (1 - swallow)) / height);
      displacement.setAttribute("scale", String(width * 0.98 * neck));
      blurRef.current?.setAttribute("stdDeviation", String(2 * smoothStep(0.8, 1, progress)));
      surface.style.transform = `translateY(${extension}px) scaleY(${stretch})`;
      surface.style.opacity = String(1 - smoothStep(0.94, 1, progress));
      shadow.style.transform = `translateY(${extension}px) scale(${1 - neck * 0.65}, ${1 - swallow * 0.9})`;
      shadow.style.opacity = String(1 - smoothStep(0.08, 0.72, progress));
    };
    // Reverse from the current shape if dismissed before opening completes.
    deform(progressRef.current);
    const animation = animate(progressRef.current, exiting ? 1 : 0, {
      duration: 0.48,
      ease: "easeInOut",
      onUpdate: deform,
      onComplete: () => {
        surface.style.willChange = "auto";
        shadow.style.willChange = "auto";
        // Remove the filter at rest so text is crisp and controls stay native.
        if (!exiting) {
          surface.style.filter = "none";
          surface.style.transform = "none";
        }
      },
    });
    return () => animation.stop();
  }, [exiting, id, reduceMotion]);

  return (
    <>
      <svg width="0" height="0" aria-hidden className="pointer-events-none absolute">
        <defs>
          <filter id={id} x="-5%" y="-10%" width="110%" height="120%" colorInterpolationFilters="sRGB">
            <feFlood floodColor="rgb(128,128,128)" result="neutral" />
            <feImage ref={mapRef} href={WARP_MAP} x="0" y="0" width="560" height="230" preserveAspectRatio="none" result="field" />
            <feComposite in="field" in2="neutral" operator="over" result="warp" />
            <feDisplacementMap ref={displacementRef} in="SourceGraphic" in2="warp" scale={reduceMotion ? 0 : 200} xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur ref={blurRef} stdDeviation={reduceMotion ? 0 : 4} />
          </filter>
        </defs>
      </svg>
      <div className={styles.genie}>
        {/* An independent, cacheable shadow moves with the panel. Filtering a
            parent would recompute every shadow from the changing warp. */}
        <div ref={shadowRef} aria-hidden className={styles.shadow} />
        <div ref={surfaceRef} className={styles.surface} style={{
          filter: reduceMotion ? "none" : `url("#${id}")`,
          transform: reduceMotion ? "none" : "scaleY(0.001)",
          opacity: reduceMotion ? 1 : 0,
        }}>{children}</div>
      </div>
    </>
  );
}
