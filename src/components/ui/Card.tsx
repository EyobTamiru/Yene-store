import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

/** Rounded, raised surface used across the Yene-Store support UI. */
export const Card = ({ children, className = "" }: CardProps) => (
  <div
    className={`rounded-2xl border border-yene-line-soft bg-yene-surface ${className}`}
  >
    {children}
  </div>
);

export const CardContent = ({ children, className = "" }: CardProps) => (
  <div className={`space-y-4 ${className}`}>{children}</div>
);
