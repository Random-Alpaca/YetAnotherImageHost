import { useLayoutEffect, useRef, useState } from "react";

// Grid columns: 4 wide (3 under 1151px, 2 under 801px), beside the 248px/224px sidebar.
const sizes = "(min-width: 1151px) calc((100vw - 360px) / 4), (min-width: 801px) calc((100vw - 300px) / 3), calc((100vw - 48px) / 2)";

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
    />
  );
}
