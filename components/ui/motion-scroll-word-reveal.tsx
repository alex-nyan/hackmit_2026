"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import styles from "./motion-scroll-word-reveal.module.css";

export interface ScrollWordRevealProps {
  paragraphs: readonly string[];
  source?: { label: string; href: string };
}

/** Zero-based word index within the complete story; progress is clamped to 0–1. */
export function getWordOpacity(progress: number, wordIndex: number, totalWords: number): number {
  if (![progress, wordIndex, totalWords].every(Number.isFinite) || totalWords <= 0) return 1;
  const normalized = Math.min(1, Math.max(0, progress));
  const wordProgress = Math.min(1, Math.max(0, normalized * totalWords - wordIndex));
  return 0.22 + wordProgress * 0.78;
}

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function ScrollWordReveal({ paragraphs, source }: ScrollWordRevealProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const enhanced = useSyncExternalStore(subscribeToHydration, hydratedSnapshot, serverSnapshot);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 0.2", "end 0.85"],
  });
  const entries = paragraphs
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => ({ paragraph, words: paragraph.trim().split(/\s+/) }));
  const totalWords = entries.reduce((total, entry) => total + entry.words.length, 0);

  useEffect(() => {
    const section = sectionRef.current;
    const content = contentRef.current;
    if (!section || !content) return;
    const measure = () => {
      // Long copy and short screens stay in normal flow, never a clipped sticky panel.
      section.dataset.sticky = String(content.offsetHeight + 112 <= window.innerHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  if (!entries.length) return null;

  return (
    <section
      ref={sectionRef}
      className={styles.section}
      aria-labelledby={headingId}
      data-enhanced={enhanced}
    >
      <div ref={contentRef} className={styles.content}>
        <div className={styles.rail} aria-hidden="true">
          <motion.div
            className={styles.progress}
            style={{ scaleY: enhanced ? scrollYProgress : 1 }}
          />
        </div>
        <div className={styles.copy}>
          {entries.map(({ paragraph, words }, paragraphIndex) => {
            const offset = entries
              .slice(0, paragraphIndex)
              .reduce((total, entry) => total + entry.words.length, 0);
            const Tag = paragraphIndex === 0 ? "h2" : "p";
            return (
              <Tag
                key={paragraphIndex}
                id={paragraphIndex === 0 ? headingId : undefined}
                className={paragraphIndex === 0 ? styles.heading : styles.paragraph}
              >
                <span className={styles.srOnly}>{paragraph}</span>
                <span aria-hidden="true">
                  {words.map((word, wordIndex) => (
                    <Word
                      key={wordIndex}
                      word={word}
                      index={offset + wordIndex}
                      total={totalWords}
                      progress={scrollYProgress}
                      enhanced={enhanced}
                      trailingSpace={wordIndex < words.length - 1}
                    />
                  ))}
                </span>
              </Tag>
            );
          })}
          {source && (
            <p className={styles.source}>
              <a href={source.href}>{source.label}</a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Word({
  word,
  index,
  total,
  progress,
  enhanced,
  trailingSpace,
}: {
  word: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
  enhanced: boolean;
  trailingSpace: boolean;
}) {
  const opacity = useTransform(progress, (value) => getWordOpacity(value, index, total));
  return (
    <motion.span className={styles.word} style={{ opacity: enhanced ? opacity : 1 }}>
      {word}
      {trailingSpace ? " " : null}
    </motion.span>
  );
}

export default ScrollWordReveal;
