/**
 * Empty state.
 *
 * A thin wrapper over shadcn's Empty primitives that fixes the props every list in this app
 * needs — icon, title, description, one action — so the decision is owned once rather than
 * re-made at each call site.
 */

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

const EmptyState = ({ icon: Icon, title, description, action, className }) => {
  return (
    <Empty className={className}>
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon" className="rounded-full">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
};

export default EmptyState;
