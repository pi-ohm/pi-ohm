export function markdownPathToSlugs(segs: string[]) {
  if (segs.length === 0) return [];

  const out = [...segs];
  const last = out.at(-1);
  if (!last) return out;

  out[out.length - 1] = last.replace(/\.md$/, "");

  if (out.length === 1 && out[0] === "index") return [];

  return out;
}

export function slugsToMarkdownPath(slugs: string[]) {
  const segments = [...slugs];

  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    const last = segments.at(-1);
    if (last) segments[segments.length - 1] = `${last}.md`;
  }

  return {
    segments,
    url: `/docs/${segments.join("/")}`,
  };
}
