import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md " +
    "font-medium " +
    "transition-[background-color,border-color,color,opacity] duration-100 select-none " +
    "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:
          "bg-surface text-foreground border border-border hover:bg-accent hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        subtle: "bg-muted text-foreground hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-6 px-2 text-[12px] [&_svg]:size-3.5",
        default: "h-7 px-2.5 text-[13px] [&_svg]:size-3.5",
        lg: "h-8 px-3.5 text-[13px] [&_svg]:size-4",
        icon: "size-7 [&_svg]:size-4",
        "icon-sm": "size-6 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

export { button as buttonVariants };
