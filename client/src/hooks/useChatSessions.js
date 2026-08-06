/**
 * The recent-conversations list.
 *
 * Separate from `useChatSession` (singular), which owns the messages of the *open*
 * conversation. This one is plain server state — a list that changes when a conversation is
 * created or receives a message — so it belongs in the Query cache, unlike the message stream.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import chatApi from '@/api/chat';
import { queryKeys } from '@/config/queryKeys';

const unwrap = (result) => {
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    error.status = result.status;
    throw error;
  }
  return result;
};

export const useChatSessions = () =>
  useQuery({
    queryKey: queryKeys.chat.sessions,
    queryFn: async () => {
      const result = unwrap(await chatApi.listSessions());
      return result.data.sessions;
    },
    // The sidebar shows this constantly, and a new message changes the ordering, so it is
    // refetched rather than served stale for long.
    staleTime: 10_000,
  });

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
