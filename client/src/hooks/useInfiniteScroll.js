/**
 * Load more when a sentinel element scrolls into view.
 *
 * An IntersectionObserver rather than a scroll listener: scroll fires continuously and would
 * need throttling and a manual "how close to the bottom am I" calculation against the
 * container's own metrics, which is the part that breaks quietly when the layout changes. The
 * observer answers the actual question — is the end of the list visible — and does it off the
 * main thread.
 *
 * `rootMargin` starts the request slightly before the sentinel is reached, so the next page is
 * usually already there by the time the person gets to the bottom.
 *
 * @param {object} options
 * @param {() => void} options.onLoadMore
 * @param {boolean} options.enabled False while a page is in flight, or once the list has
 *   ended — this is what stops one scroll from firing several overlapping requests.
 * @param {import('react').RefObject<Element | null>} [options.rootRef] The scrolling
 *   container. Defaults to the viewport, which is wrong whenever the list scrolls inside a
 *   panel of its own.
 * @returns {import('react').RefObject<HTMLElement | null>} Ref to place on the sentinel.
 */

import { useEffect, useRef } from 'react';

export const useInfiniteScroll = ({ onLoadMore, enabled, rootRef }) => {
  const sentinelRef = useRef(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    // Guarded rather than assumed: jsdom does not implement it, and neither do a few browsers
    // still in the wild. Without the observer the list simply stops growing, which is the old
    // behaviour rather than a crash.
    if (!sentinel || !enabled || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { root: rootRef?.current ?? null, rootMargin: '120px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, onLoadMore, rootRef]);

  return sentinelRef;
};

export default useInfiniteScroll;
