import React from "react";

type Variant = "primary" | "ghost" | "outline";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-yene-accent text-yene-on-accent hover:bg-yene-accent-strong disabled:hover:bg-yene-accent font-semibold",
  ghost:
    "bg-transparent text-yene-muted hover:text-yene-text hover:bg-yene-raised",
  outline:
    "border border-yene-line bg-transparent text-yene-text hover:border-yene-accent hover:text-yene-accent",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  fullWidth?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}

export const Button = ({
  children,
  onClick,
  type = "button",
  variant = "primary",
  size = "md",
  disabled = false,
  fullWidth = false,
  title,
  ariaLabel,
  className = "",
}: ButtonProps) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel}
    className={`inline-flex items-center justify-center gap-2 rounded-xl transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg disabled:cursor-not-allowed disabled:opacity-50 ${
      VARIANTS[variant]
    } ${SIZES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
  >
    {children}
  </button>
);
