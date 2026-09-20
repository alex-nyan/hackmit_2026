"use client";

import { useRef, type ReactNode } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import styles from "./container-scroll-animation.module.css";

export interface ContainerScrollProps {
  titleComponent: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Finish the tilt as the tablet reaches the viewing area, independent of page length. */
export function ContainerScroll({ titleComponent, children, className }: ContainerScrollProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress, scrollY } = useScroll({
    target: frameRef,
    offset: ["start 0.6", "start 0.18"],
  });
  const rotate = useTransform(scrollYProgress, [0, 1], [20, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1.05, 1]);
  const translate = useTransform(scrollY, [0, 240], [0, -100]);

  return (
    <div className={[styles.container, className].filter(Boolean).join(" ")}>
      <div className={styles.stage}>
        <Header translate={translate} titleComponent={titleComponent} />
        <div ref={frameRef} className={styles.frame}>
          <Card rotate={rotate} scale={scale}>
            {children}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function Header({
  translate,
  titleComponent,
}: {
  translate: MotionValue<number>;
  titleComponent: ReactNode;
}) {
  const responsiveTranslate = useTransform(
    translate,
    (value) => `calc(${value}px * var(--container-scroll-title-scale, 1))`,
  );
  return (
    <motion.div className={styles.header} style={{ y: responsiveTranslate }}>
      {titleComponent}
    </motion.div>
  );
}

export function Card({
  rotate,
  scale,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  children: ReactNode;
}) {
  return (
    <motion.div className={styles.card} style={{ rotateX: rotate, scale }}>
      <div className={styles.screen}>{children}</div>
    </motion.div>
  );
}
