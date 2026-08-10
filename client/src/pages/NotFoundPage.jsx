import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '@/components/ui/empty';
import { ROUTES } from '@/config/constants';

const NotFoundPage = () => {
  return (
    <Empty className="min-h-dvh">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-12 rounded-full">
          <Compass className="size-6" aria-hidden="true" />
        </EmptyMedia>
        {/* A real h1: shadcn's EmptyTitle renders a div, and this is the page title. */}
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <EmptyDescription>That link does not lead anywhere.</EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <Button asChild>
          <Link to={ROUTES.CHAT}>Back to the assistant</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
};

export default NotFoundPage;
