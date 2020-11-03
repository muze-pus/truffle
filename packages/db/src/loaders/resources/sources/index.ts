import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:resources:sources");

import { toIdObject } from "@truffle/db/meta";

import {
  CompilationData,
  LoadedSources,
  Load
} from "@truffle/db/loaders/types";

import { AddSources } from "./add.graphql";
export { AddSources };

// returns list of IDs
export function* generateSourcesLoad(
  compilation: CompilationData
): Load<LoadedSources, { graphql: "sourcesAdd" }> {
  // for each compilation, we need to load sources for each of the contracts
  const inputs = compilation.sources.map(({ input }) => input);

  const result = yield {
    type: "graphql",
    request: AddSources,
    variables: { sources: inputs }
  };

  const { sources } = result.data.sourcesAdd;

  // return source IDs mapped by sourcePath
  return sources.reduce(
    (obj, source) => ({
      ...obj,
      [source.sourcePath]: toIdObject(source)
    }),
    {}
  );
}
