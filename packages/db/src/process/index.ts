import { logger } from "@truffle/db/logger";
const debug = logger("db:process");

import { Collections } from "@truffle/db/meta";

export * from "./types";
import { _ } from "./batch";
import * as Batch from "./batch";
export { _, Batch };
export * from "./resources";
export * from "./run";

import { Definitions } from "./types";
import { runForDefinitions } from "./run";
import { resourceProcessorsForDefinitions } from "./resources";

export const forDefinitions = <C extends Collections>(
  definitions: Definitions<C>
) => ({
  forDb: runForDefinitions<C>(definitions),
  resources: resourceProcessorsForDefinitions(definitions)
});
