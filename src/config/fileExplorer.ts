import type { FileType } from "../lib/types";

type FileExplorerConfig = {
  defaultType: FileType;
  availableTypes: FileType[];
  showTypeToggle: boolean;
  allowedExtensions: Partial<Record<FileType, string[]>>;
  rootLabels: Partial<Record<FileType, string>>;
};

// FileType defines the full set of supported backend file domains.
// This config decides which of those domains are exposed in this UI build.
export const fileExplorerConfig: FileExplorerConfig = {
  defaultType: "script",
  availableTypes: ["script", "fpga"],
  showTypeToggle: true,
  allowedExtensions: {
    script: [".qil"],
    fpga: [".py"],
  },
  rootLabels: {
    script: "/user_scripts",
    fpga: "/user_fpga",
  },
};
