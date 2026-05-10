import { createFileRoute, notFound } from "@tanstack/react-router";
import { markdownPathToSlugs } from "@/lib/markdown-path";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { getLLMText } = await import("@/lib/get-llm-text");
        const { source } = await import("@/lib/source");
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const page = source.getPage(slugs);
        if (!page) throw notFound();

        return new Response(await getLLMText(page), {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});
