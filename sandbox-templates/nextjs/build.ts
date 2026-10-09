import { Template, defaultBuildLogger } from "e2b";
import { template as nextJSTemplate } from "./template";
import dotenv from "dotenv";
dotenv.config();

Template.build(nextJSTemplate, "v0-clone", {
  cpuCount: 4,
  memoryMB: 4096,
  onBuildLogs: defaultBuildLogger(),
  apiKey: "e2b_aba4636b2a91785b609f12a3839bfb86d033695f",
});
