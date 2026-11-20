"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { resolveMediaReference } from "@/lib/stream-url";

export function useResolvedImageUrl(reference?: string | null): string | undefined {
  const [signed, setSigned] = useState<{ reference: string; url: string } | null>(null);
  const opaque = Boolean(reference?.startsWith("media-asset:"));

  useEffect(() => {
    let active = true;
    if (reference && opaque) resolveMediaReference("image", reference)
      .then(url => { if (active) setSigned({ reference, url }); })
      .catch(() => { /* Callers render their normal empty-image fallback. */ });
    return () => { active = false; };
  }, [opaque, reference]);

  if (!reference) return undefined;
  if (!opaque) return reference;
  return signed?.reference === reference ? signed.url : undefined;
}

export default function SecureImage({ src, alt, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & { src?: string | null; alt: string }) {
  const resolved = useResolvedImageUrl(src);
  if (!resolved) return null;
  // Signed media URLs are intentionally dynamic and bypass Next's public image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={resolved} alt={alt} />;
}
