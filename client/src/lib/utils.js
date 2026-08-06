import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, letting later Tailwind utilities win over earlier ones.
 * Required by the shadcn/ui primitives.
 */
export const cn = (...inputs) => twMerge(clsx(inputs));
