import type { FileType } from "../lib/types";

export const fileExplorerConfig: {
  defaultType: FileType;
  showTypeToggle: boolean;
  allowedExtensions: string[];
} = {
  defaultType: "script",
  showTypeToggle: true,
  allowedExtensions: [".qil"],
};
