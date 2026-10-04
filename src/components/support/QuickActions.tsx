import {
  Boxes,
  CreditCard,
  Headset,
  Package,
  ShoppingCart,
  Store,
  Tags,
  UserCircle,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { QUICK_ACTIONS, type QuickAction } from "../../constants";

const ICONS: Record<string, LucideIcon> = {
  "how-it-works": Waypoints,
  "my-account": UserCircle,
  "my-package": Package,
  "store-help": Store,
  orders: ShoppingCart,
  promotions: Tags,
  inventory: Boxes,
  billing: CreditCard,
  "contact-agent": Headset,
};

interface QuickActionsProps {
  onSelect: (action: QuickAction) => void;
  disabled?: boolean;
}

export const QuickActions = ({ onSelect, disabled }: QuickActionsProps) => (
  <div className="px-4 pb-1">
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-yene-faint">
      Quick actions
    </p>
    <div className="flex flex-wrap gap-1.5">
      {QUICK_ACTIONS.map((action) => {
        const Icon = ICONS[action.id] ?? Waypoints;
        const isHandoff = action.opensHandoff === true;
        return (
          <button
            key={action.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(action)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-yene-accent disabled:cursor-not-allowed disabled:opacity-50 ${
              isHandoff
                ? "border-yene-accent/50 bg-yene-accent-dim text-yene-accent hover:bg-yene-accent/20"
                : "border-yene-line bg-yene-surface text-yene-text hover:border-yene-accent/50 hover:text-yene-accent"
            }`}
          >
            <Icon size={13} aria-hidden="true" />
            {action.label}
          </button>
        );
      })}
    </div>
  </div>
);
