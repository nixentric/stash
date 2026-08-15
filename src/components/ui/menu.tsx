import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as CM from "@radix-ui/react-context-menu";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const panel =
  "z-50 min-w-[11rem] overflow-hidden rounded-lg border border-border bg-surface-raised p-1 " +
  "shadow-xl shadow-black/20 outline-none " +
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] " +
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0";

const item =
  "relative flex cursor-default select-none items-center gap-2 rounded-[5px] px-2 py-[5px] " +
  "text-[13px] outline-none transition-none " +
  "focus:bg-accent focus:text-accent-foreground " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40 " +
  "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground " +
  "focus:[&_svg]:text-foreground";

const label = "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground";
const separator = "-mx-1 my-1 h-px bg-border";
const shortcut = "ml-auto pl-4 text-[11px] tabular-nums text-subtle-foreground";

// ── dropdown ────────────────────────────────────────────────────────────────

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuSub = DM.Sub;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DM.Content>,
  React.ComponentPropsWithoutRef<typeof DM.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DM.Portal>
    <DM.Content ref={ref} sideOffset={sideOffset} className={cn(panel, className)} {...props} />
  </DM.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DM.Item>,
  React.ComponentPropsWithoutRef<typeof DM.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <DM.Item
    ref={ref}
    className={cn(item, destructive && "text-destructive focus:text-destructive", className)}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DM.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DM.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DM.CheckboxItem ref={ref} className={cn(item, "pl-7", className)} {...props}>
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <DM.ItemIndicator>
        <Check className="size-3.5" />
      </DM.ItemIndicator>
    </span>
    {children}
  </DM.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioGroup = DM.RadioGroup;

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof DM.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DM.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DM.RadioItem ref={ref} className={cn(item, "pl-7", className)} {...props}>
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <DM.ItemIndicator>
        <Check className="size-3.5" />
      </DM.ItemIndicator>
    </span>
    {children}
  </DM.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DM.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DM.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DM.SubTrigger
    ref={ref}
    className={cn(item, "data-[state=open]:bg-accent", className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3.5" />
  </DM.SubTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

export const DropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DM.SubContent>,
  React.ComponentPropsWithoutRef<typeof DM.SubContent>
>(({ className, ...props }, ref) => (
  <DM.Portal>
    <DM.SubContent ref={ref} className={cn(panel, className)} {...props} />
  </DM.Portal>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export const DropdownMenuLabel = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DM.Label>) => (
  <DM.Label className={cn(label, className)} {...props} />
);

export const DropdownMenuSeparator = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DM.Separator>) => (
  <DM.Separator className={cn(separator, className)} {...props} />
);

export const MenuShortcut = ({ className, ...props }: React.ComponentProps<"span">) => (
  <span className={cn(shortcut, className)} {...props} />
);

// ── context menu ────────────────────────────────────────────────────────────

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export const ContextMenuSub = CM.Sub;
export const ContextMenuGroup = CM.Group;

export const ContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof CM.Content>,
  React.ComponentPropsWithoutRef<typeof CM.Content>
>(({ className, ...props }, ref) => (
  <CM.Portal>
    <CM.Content ref={ref} className={cn(panel, className)} {...props} />
  </CM.Portal>
));
ContextMenuContent.displayName = "ContextMenuContent";

export const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof CM.Item>,
  React.ComponentPropsWithoutRef<typeof CM.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <CM.Item
    ref={ref}
    className={cn(item, destructive && "text-destructive focus:text-destructive", className)}
    {...props}
  />
));
ContextMenuItem.displayName = "ContextMenuItem";

export const ContextMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof CM.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof CM.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <CM.SubTrigger
    ref={ref}
    className={cn(item, "data-[state=open]:bg-accent", className)}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3.5" />
  </CM.SubTrigger>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

export const ContextMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof CM.SubContent>,
  React.ComponentPropsWithoutRef<typeof CM.SubContent>
>(({ className, ...props }, ref) => (
  <CM.Portal>
    <CM.SubContent ref={ref} className={cn(panel, className)} {...props} />
  </CM.Portal>
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

export const ContextMenuSeparator = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Separator>) => (
  <CM.Separator className={cn(separator, className)} {...props} />
);

export const ContextMenuLabel = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CM.Label>) => (
  <CM.Label className={cn(label, className)} {...props} />
);
