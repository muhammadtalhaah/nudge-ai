/**
 * Empty state. shadcn/ui has no equivalent of Ant Design's Empty, so this is the shared
 * component that owns the decision once instead of every list inventing its own.
 */

import { cn } from '@/lib/utils';

const EmptyState = ({ icon: Icon, title, description, action, className }) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="bg-muted rounded-full p-3">
          <Icon className="text-muted-foreground size-6" aria-hidden="true" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
};

export default EmptyState;
