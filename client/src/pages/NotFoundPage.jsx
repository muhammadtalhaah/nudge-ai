import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ROUTES } from '@/config/constants';

const NotFoundPage = () => {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <Compass className="text-muted-foreground size-10" aria-hidden="true" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">That link does not lead anywhere.</p>
      </div>
      <Button asChild>
        <Link to={ROUTES.CHAT}>Back to the assistant</Link>
      </Button>
    </div>
  );
};

export default NotFoundPage;
