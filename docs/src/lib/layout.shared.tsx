import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import lightLogo from "../../../assets/ohm-transparent-light.png";
import darkLogo from "../../../assets/ohm-transparent-dark.png";

export const gitConfig = {
  user: "pi-ohm",
  repo: "pi-ohm",
  branch: "dev",
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span className="relative size-6 overflow-hidden rounded-sm">
            <img
              src={darkLogo}
              alt="pi-ohm"
              className="absolute inset-0 h-full w-full object-cover dark:hidden"
            />
            <img
              src={lightLogo}
              alt="pi-ohm"
              className="absolute inset-0 hidden h-full w-full object-cover dark:block"
            />
          </span>
          <span className="sr-only">pi-ohm</span>
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
