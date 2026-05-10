import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { createServerFn } from "@tanstack/react-start";
import { slugsToMarkdownPath } from "@/lib/markdown-path";
import browserCollections from "fumadocs-mdx:collections/browser";
import { DocsBody, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { baseOptions, gitConfig } from "@/lib/layout.shared";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense } from "react";
import { LLMCopyButton, ViewOptions } from "@/components/ai/page-actions";
import { StripeTOC } from "@/components/toc/stripe";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    const data = await loader({ data: slugs });
    await clientLoader.preload(data.path);
    return data;
  },
});

const loader = createServerFn({
  method: "GET",
})
  .inputValidator((slugs: string[]) => slugs)
  .middleware([staticFunctionMiddleware])
  .handler(async ({ data: slugs }) => {
    const { source } = await import("@/lib/source");
    const page = source.getPage(slugs);
    if (!page) throw notFound();

    return {
      slugs: page.slugs,
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    // you can define props for the component
    {
      markdownUrl,
      pageMarkdownUrl,
      path,
    }: {
      markdownUrl: string;
      pageMarkdownUrl: string;
      path: string;
    },
  ) {
    return (
      <DocsPage
        toc={toc}
        tableOfContent={{
          component: <StripeTOC items={toc} />,
        }}
        tableOfContentPopover={{
          style: "clerk",
        }}
      >
        <div className="flex flex-row gap-2 justify-between pb-2">
          <DocsTitle>{frontmatter.title}</DocsTitle>
          {/** <DocsDescription>{frontmatter.description}</DocsDescription> */}
          <div className="flex flex-row gap-2 items-center">
            <LLMCopyButton markdownUrl={markdownUrl} />
            <ViewOptions
              pageMarkdownUrl={pageMarkdownUrl}
              githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${path}`}
            />
          </div>
        </div>
        <DocsBody>
          <MDX
            components={{
              ...defaultMdxComponents,
            }}
          />
        </DocsBody>
      </DocsPage>
    );
  },
});

function Page() {
  const { pageTree, slugs, path } = useFumadocsLoader(Route.useLoaderData());
  const markdownUrl = `/llms.mdx/docs/${[...slugs, "index.mdx"].join("/")}`;
  const pageMarkdownUrl = slugsToMarkdownPath(slugs).url;

  return (
    <DocsLayout
      {...baseOptions()}
      tree={pageTree}
      sidebar={{
        collapsible: false,
        tabs: false,
        className: "border-e-0 bg-transparent",
      }}
    >
      <Link to={markdownUrl} hidden />
      <Link to={pageMarkdownUrl} hidden />
      <Suspense>{clientLoader.useContent(path, { markdownUrl, pageMarkdownUrl, path })}</Suspense>
    </DocsLayout>
  );
}
