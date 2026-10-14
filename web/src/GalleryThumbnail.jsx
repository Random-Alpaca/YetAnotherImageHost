import { useLayoutEffect, useRef, useState } from "react";

// The grid has a 1024px maximum width, 16px side padding and 12px gaps.
const sizes = "(min-width: 1024px) 239px, (min-width: 768px) calc((100vw - 68px) / 4), (min-width: 640px) calc((100vw - 56px) / 3), calc((100vw - 44px) / 2)";

export default function GalleryThumbnail({ image }) {
  const element = useRef(null);
  const [loading, setLoading] = useState(null);
  const [failedSource, setFailedSource] = useState(null);
  const previewsByWidth = new Map();
  for (const preview of image.thumbnails || []) {
    if (preview.url && preview.width > 0 && !previewsByWidth.has(preview.width)) {
      previewsByWidth.set(preview.width, preview);
    }
  }
  const previews = [...previewsByWidth.values()].sort((a, b) => a.width - b.width);
  const source = previews.map((preview) => preview.url).join(",");
  const usePreviews = previews.length > 0 && failedSource !== source;

  useLayoutEffect(() => {
    // Folder tiles and upload controls can push even the first photo below the
    // fold. Measure the reserved image box before assigning a URL so only
    // photos actually visible on insertion get an eager request.
    const rect = element.current.getBoundingClientRect();
    setLoading(rect.top < window.innerHeight && rect.bottom > 0 &&
      rect.left < window.innerWidth && rect.right > 0 ? "eager" : "lazy");
  }, []);

  return (
    <img
      ref={element}
      src={loading ? (usePreviews ? previews[0].url : image.url) : undefined}
      srcSet={loading && usePreviews ? previews.map((preview) => `${preview.url} ${preview.width}w`).join(", ") : undefined}
      sizes={usePreviews ? sizes : undefined}
      alt={image.original_name || image.id}
      loading={loading || "lazy"}
      decoding="async"
      onError={usePreviews ? () => setFailedSource(source) : undefined}
      className="w-full h-40 object-cover"
    />
  );
}
