export { ohmMetaTable } from "./meta";
export { ohmStateTable } from "./state";
export {
  ohmSubagentSessionEventTable,
  ohmSubagentSessionTable,
  type OhmSubagentSessionEventRow,
  type OhmSubagentSessionRow,
} from "./subagent";
export { OHM_DB_SCHEMA_VERSION } from "./version";

import { ohmMetaTable } from "./meta";
import { ohmStateTable } from "./state";
import { ohmSubagentSessionEventTable, ohmSubagentSessionTable } from "./subagent";

export const schema = {
  ohmMetaTable,
  ohmStateTable,
  ohmSubagentSessionTable,
  ohmSubagentSessionEventTable,
} as const;
