"use client"

/**
 * Table primitives.
 *
 * Written by hand to match shadcn/ui's new-york table component, because the registry was
 * unreachable from this environment when the rest of the primitives were generated. These are
 * thin styled wrappers over semantic table elements with no Radix dependency, so there is
 * nothing here the CLI would have added beyond the same markup. If the registry becomes
 * reachable, `npx shadcn add table --overwrite` will replace this file cleanly.
 */

import { cn } from "@/lib/utils"

const Table = ({ className, ...props }) => (
  <div className="relative w-full overflow-x-auto">
    <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
)

const TableHeader = ({ className, ...props }) => (
  <thead className={cn("[&_tr]:border-b", className)} {...props} />
)

const TableBody = ({ className, ...props }) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
)

const TableFooter = ({ className, ...props }) => (
  <tfoot
    className={cn("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
)

const TableRow = ({ className, ...props }) => (
  <tr
    className={cn(
      "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
      className
    )}
    {...props}
  />
)

const TableHead = ({ className, ...props }) => (
  <th
    className={cn(
      "text-muted-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
)

const TableCell = ({ className, ...props }) => (
  <td
    className={cn("p-2 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
)

const TableCaption = ({ className, ...props }) => (
  <caption className={cn("text-muted-foreground mt-4 text-sm", className)} {...props} />
)

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
