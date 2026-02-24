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
  };
}
