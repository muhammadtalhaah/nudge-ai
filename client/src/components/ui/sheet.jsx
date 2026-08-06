'use client';

/**
 * Slide-in panel, used for the sidebar on small screens.
 *
 * Hand-written because the shadcn registry was unreachable from this environment. It is built
 * on the same Radix Dialog primitives the generated `dialog.jsx` uses, so it inherits focus
 * trapping, Escape-to-close, scroll locking and correct ARIA for free — the difference is
 * purely that it slides from an edge instead of appearing centred.
 */

import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const Sheet = ({ ...props }) => <SheetPrimitive.Root data-slot="sheet" {...props} />;

const SheetTrigger = ({ ...props }) => (
  <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
);

const SheetClose = ({ ...props }) => <SheetPrimitive.Close data-slot="sheet-close" {...props} />;

const SheetOverlay = ({ className, ...props }) => (
  <SheetPrimitive.Overlay
    data-slot="sheet-overlay"
    className={cn(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
      className,
    )}
    {...props}
  />
);

/**
 * `side` picks the edge. Only 'left' is used here, but the others cost nothing and keep the
 * component honest about being a general primitive.
 */
const SheetContent = ({ className, children, side = 'left', ...props }) => (
  <SheetPrimitive.Portal data-slot="sheet-portal">
    <SheetOverlay />
    <SheetPrimitive.Content
      data-slot="sheet-content"
      className={cn(
        'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
        side === 'left' &&
          'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 max-w-72 border-r',
        side === 'right' &&
          'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 max-w-72 border-l',
        side === 'top' &&
          'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
        side === 'bottom' &&
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
        className,
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
        <XIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
);

const SheetHeader = ({ className, ...props }) => (
  <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
);

const SheetTitle = ({ className, ...props }) => (
  <SheetPrimitive.Title
    data-slot="sheet-title"
    className={cn('text-foreground font-semibold', className)}
    {...props}
  />
);

const SheetDescription = ({ className, ...props }) => (
  <SheetPrimitive.Description
    data-slot="sheet-description"
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
);

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
};
