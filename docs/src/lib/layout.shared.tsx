import { ArrowLeftRight, Bot, Gauge, Palette, Search } from "lucide-react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const gitConfig = {
  user: "pi-ohm",
  repo: "pi-ohm",
  branch: "dev",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "pi-ohm",
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        type: "main",
        text: "Subagents",
        url: "/docs/subagents",
        icon: <Bot className="size-4" />,
        active: "nested-url",
      },
      {
        type: "main",
        text: "Modes",
        url: "/docs/modes",
        icon: <Gauge className="size-4" />,
        active: "nested-url",
      },
      {
        type: "main",
        text: "Painter",
        url: "/docs/painter",
        icon: <Palette className="size-4" />,
        active: "nested-url",
      },
      {
        type: "main",
        text: "Handoff",
        url: "/docs/handoff",
        icon: <ArrowLeftRight className="size-4" />,
        active: "nested-url",
      },
      {
        type: "main",
        text: "Session Search",
        url: "/docs/session-search",
        icon: <Search className="size-4" />,
        active: "nested-url",
      },
    ],
  };
}
