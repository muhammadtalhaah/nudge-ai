import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // shadcn ships a pair of selection-variant utilities here that paint a 100%-opaque
        // accent fill behind selected input text. Dropped deliberately: it was louder than
        // every other selection in the app and the one place the highlight hid the characters
        // under it. Inputs now fall to the ::selection rule in theme.css, so the whole app
        // selects the same way from one token. Regenerating this primitive from the shadcn CLI
        // brings them back. (Naming those classes in this comment would be enough for the
        // Tailwind extractor to re-emit them — it scans comments too — hence the prose.)
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        // The border is the whole error signal. Repeating it under focus-visible is not
        // redundant: the focus rule above also sets a border colour at equal specificity, so
        // without the compound variant an invalid field would lose its red edge the moment it
        // was focused — exactly when the user is fixing it. The ring stays the normal accent;
        // recolouring it would add a second red element around the field.
        'aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
