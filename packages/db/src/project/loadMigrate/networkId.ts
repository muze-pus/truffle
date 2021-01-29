/**
 * @category Internal processor
 * @packageDocumentation
 */
import { logger } from "@truffle/db/logger";
const debug = logger("db:project:loadMigrate:networkId");

import { Process } from "@truffle/db/process";

export function* process(): Process<any, { web3: "net_version" }> {
  debug("Generating networkId fetch...");

  const response = yield {
    type: "web3",
    method: "net_version"
  };

  const { result } = response;

  const networkId = parseInt(result);

  debug("Generated networkId fetch.");
  return networkId;
}
