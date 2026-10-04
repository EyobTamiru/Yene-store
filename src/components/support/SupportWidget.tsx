import { AnimatePresence, motion } from "motion/react";
import { Headset, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BRAND } from "../../constants";
import { ChatPanel } from "./ChatPanel";

interface SupportWidgetProps {
  onOpenFullPage?: () => void;
}

/**
 * Floating support entry point.
 *
 * Layout strategy (mobile-first):
 *  - < 640px  : full-screen panel, launcher hidden while open
 *  - >= 640px : docked 23.5rem panel sitting above a persistent launcher
 * The launcher is always visible on desktop so support is one click away.
 */
export const SupportWidget = ({ onOpenFullPage }: SupportWidgetProps) => {
  const [open, setOpen] = useState(false);

  // Escape closes the panel - expected of any dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const openFullPage = () => {
    setOpen(false);
    onOpenFullPage?.();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-end sm:inset-auto sm:bottom-5 sm:right-5">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="pointer-events-auto fixed inset-0 sm:static sm:z-auto sm:mb-3 sm:w-[23.5rem]"
            role="dialog"
            aria-modal="true"
            aria-label={`${BRAND.aiName} chat`}
          >
            {/* Mobile tap-to-dismiss backdrop. */}
            <div
              className="absolute inset-0 bg-black/50 sm:hidden"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div className="relative h-full w-full sm:h-[32rem]">
              <ChatPanel
                variant="widget"
                onClose={() => setOpen(false)}
                onExpand={onOpenFullPage}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close Yene AI Support" : "Open Yene AI Support"}
        className={`yene-glow pointer-events-auto relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-yene-accent text-yene-on-accent transition-transform duration-150 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent focus-visible:ring-offset-2 focus-visible:ring-offset-yene-bg active:scale-95 ${
          open ? "hidden sm:flex" : "flex"
        } ${open ? "" : "mb-4 sm:mb-0"}`}
      >
        {open ? <X size={22} /> : <Headset size={24} />}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-yene-bg bg-yene-accent" />
        )}
      </button>
    </div>
  );
};
