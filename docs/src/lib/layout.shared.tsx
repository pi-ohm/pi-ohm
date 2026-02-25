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
          <span className="inline-flex items-center overflow-hidden rounded-sm">
            <img src={lightLogo} alt="pi-ohm" className="h-6 w-auto object-contain dark:hidden" />
            <img
              src={darkLogo}
              alt="pi-ohm"
              className="hidden h-6 w-auto object-contain dark:block"
            />
          </span>
          <span className="sr-only">pi-ohm</span>
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
