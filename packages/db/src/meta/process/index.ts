import { logger } from "@truffle/db/logger";
const debug = logger("db:meta:process");

import { Collections } from "@truffle/db/meta/collections";

export { Process, Processor, ProcessRequest, RequestType } from "./types";
export { ResourceProcessors, ResourceProcessorsOptions } from "./resources";
export { ProcessorRunner } from "./run";

export { Definition, Definitions } from "./types";

import { Definitions } from "./types";
import { runForDefinitions } from "./run";
import { resourceProcessorsForDefinitions } from "./resources";

export const forDefinitions = <C extends Collections>(
  definitions: Definitions<C>
) => ({
  forDb: runForDefinitions<C>(definitions),
  resources: resourceProcessorsForDefinitions(definitions)
});
