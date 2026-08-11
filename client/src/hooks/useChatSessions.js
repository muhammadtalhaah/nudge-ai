/**
 * The recent-conversations list.
 *
 * Separate from `useChatSession` (singular), which owns the messages of the *open*
 * conversation. This one is plain server state — a list that changes when a conversation is
 * created or receives a message — so it belongs in the Query cache, unlike the message stream.
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import chatApi from '@/api/chat';
import { queryKeys } from '@/config/queryKeys';

/** Enough to fill the sidebar on a tall screen without a second request on open. */
const PAGE_SIZE = 20;

const unwrap = (result) => {
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    error.status = result.status;
    throw error;
  }
  return result;
};

/**
 * The conversation list, one page at a time.
 *
 * Infinite rather than paged because the sidebar is a scrolling list with no page controls:
 * reaching the bottom is the request. `data` is flattened to a plain array so the component
 * renders a list and not a list of pages — the paging is this hook's business.
 *
 * The cursor is opaque and simply handed back to the server. It is deliberately not part of
 * the query key: an invalidation after a new message must refetch the *whole* list from the
 * top, and TanStack refetches every loaded page under one key to do that.
 */
export const useChatSessions = () => {
  const query = useInfiniteQuery({
    queryKey: queryKeys.chat.sessions,
    queryFn: async ({ pageParam }) => {
      const result = unwrap(await chatApi.listSessions({ cursor: pageParam, limit: PAGE_SIZE }));
      return result.data;
    },
    initialPageParam: undefined,
    // Null is the server saying the list has ended; undefined is what stops TanStack asking.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // The sidebar shows this constantly, and a new message changes the ordering, so it is
    // refetched rather than served stale for long.
    staleTime: 10_000,
  });

  return {
    ...query,
    sessions: query.data?.pages.flatMap((page) => page.sessions) ?? [],
  };
};

export const useCreateChatSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = unwrap(await chatApi.createSession({}));
      return result.data.session;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.sessions });
    },
  });
};

export default { useChatSessions, useCreateChatSession };
