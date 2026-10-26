"use client";

import { motion } from "framer-motion";

/** Original Lumen mark: a rounded eight-ray spark. */
export function Spark({ size = 26, spin = false }: { size?: number; spin?: boolean }) {
  const rays = Array.from({ length: 8 });
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      animate={spin ? { rotate: 360 } : undefined}
      transition={spin ? { repeat: Infinity, duration: 6, ease: "linear" } : undefined}
      aria-hidden
    >
      {rays.map((_, i) => (
        <line
          key={i}
          x1="0"
          y1="-4"
          x2="0"
          y2={i % 2 ? "-8" : "-11"}
          stroke="#c96442"
          strokeWidth="2.6"
          strokeLinecap="round"
          transform={`rotate(${i * 45})`}
        />
      ))}
    </motion.svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <Spark />
      Lumen
    </span>
  );
}
