import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      // Nothing here is a web form: no field wants the webview's saved-value
      // dropdown, and macOS autocorrect rewriting a URL or a path is worse than
      // useless. Before the spread, so a caller can still ask for them.
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={cn(
        "flex h-7 w-full rounded-md border border-input bg-surface px-2 py-1 text-[13px]",
        "placeholder:text-subtle-foreground outline-none transition-colors",
        "focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex w-full rounded-md border border-input bg-surface px-2 py-1.5 text-[13px] leading-relaxed",
      "placeholder:text-subtle-foreground outline-none transition-colors resize-none",
      "focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/25",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
