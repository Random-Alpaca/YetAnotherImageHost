import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 48;
const MAX_CACHED_FOLDERS = 8;
const MAX_CACHED_IMAGES = 480;
const empty = {
  images: [], total: 0, nextCursor: null, album: null, pages: 0,
  hasData: false, loading: true, refreshing: false, loadingMore: false, error: "", errorStatus: null,
};

// A cache belongs to one mounted gallery. Callers remount when the signed-in
// user or public-album slug changes, so cached private data cannot cross users.
export default function usePagedGallery(key, fetchPage) {
  const [state, setState] = useState({ ...empty, key });
  const stateRef = useRef(state);
  const keyRef = useRef(key);
  const cache = useRef(new Map());
  const request = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  keyRef.current = key;

  const publish = useCallback((next) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const remember = useCallback((entry) => {
    cache.current.delete(entry.key);
    // A deliberately expanded active gallery can be larger than the cache;
    // do not retain that many images once the user leaves it.
    if (entry.images.length > MAX_CACHED_IMAGES) return;
    cache.current.set(entry.key, entry);
    let imageCount = [...cache.current.values()].reduce((sum, value) => sum + value.images.length, 0);
    while (cache.current.size > MAX_CACHED_FOLDERS || imageCount > MAX_CACHED_IMAGES) {
      const oldest = cache.current.keys().next().value;
      imageCount -= cache.current.get(oldest).images.length;
      cache.current.delete(oldest);
    }
  }, []);

  const run = useCallback(async (folderKey, append = false) => {
    if (!mounted.current || folderKey !== keyRef.current) return;
    const previous = stateRef.current.key === folderKey ? stateRef.current : cache.current.get(folderKey);
    if (append && (!previous?.nextCursor || previous.loadingMore || previous.refreshing)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    const active = () => mounted.current && !controller.signal.aborted &&
      version === generation.current && folderKey === keyRef.current;
    const starting = {
      ...empty, ...previous, key: folderKey, error: "", errorStatus: null,
      loading: !previous?.hasData, refreshing: !append && !!previous?.hasData, loadingMore: append,
    };
    publish(starting);
    try {
      // Revalidation replaces the loaded prefix atomically, keeping the same
      // number of pages. New uploads can shift cursor boundaries; fetching the
      // prefix again avoids duplicates and gaps without unmounting the grid.
      const pageCount = append ? 1 : Math.max(previous?.pages || 1, 1);
      let images = append ? [...previous.images] : [];
      let cursor = append ? previous.nextCursor : null;
      let data;
      let pages = append ? previous.pages : 0;
      for (let page = 0; page < pageCount; page++) {
        data = await fetchPage(folderKey, { limit: PAGE_SIZE, cursor, signal: controller.signal });
        if (!active()) return;
        images.push(...(data.images || []));
        cursor = data.next_cursor || null;
        pages++;
        if (!cursor) break;
      }
      const unique = [...new Map(images.map((image) => [image.id, image])).values()];
      const next = {
        ...starting, images: unique, total: data.total ?? unique.length,
        nextCursor: cursor, album: data.album || previous?.album || null, pages,
        hasData: true, loading: false, refreshing: false, loadingMore: false,
      };
      remember(next);
      publish(next);
    } catch (error) {
      if (!active() || error.name === "AbortError") return;
      const accessLost = [401, 403, 404].includes(error.status);
      if (error.status === 401) cache.current.clear();
      else if (accessLost) cache.current.delete(folderKey);
      publish({
        ...(accessLost ? { ...empty, key: folderKey } : starting),
        loading: false, refreshing: false, loadingMore: false, error: error.message,
        errorStatus: error.status ?? null,
      });
    }
  }, [fetchPage, publish, remember]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    run(key);
    return () => request.current?.abort();
  }, [key, run]);

  const refresh = useCallback(({ invalidate = false } = {}) => {
    if (invalidate) cache.current.clear();
    return run(keyRef.current);
  }, [run]);

  // Apply confirmed mutations immediately and invalidate all other snapshots.
  // Aborting also prevents an older list response from restoring a deleted
  // image or its previous visibility URL.
  const update = useCallback((transform, totalChange = 0) => {
    cache.current.clear();
    request.current?.abort();
    generation.current++;
    const current = stateRef.current;
    if (!mounted.current || current.key !== keyRef.current) return;
    const images = transform(current.images);
    const next = {
      ...current, images, total: Math.max(0, current.total + totalChange),
      loading: false, refreshing: false, loadingMore: false,
    };
    publish(next);
  }, [publish]);

  const visible = state.key === key ? state : (cache.current.get(key) || { ...empty, key });
  return { ...visible, refresh, update, loadMore: () => run(keyRef.current, true) };
}
