import { logger } from "@truffle/db/logger";
const debug = logger("db:project:compile:sources");

import { IdObject, resources } from "@truffle/db/project/process";
import * as Batch from "./batch";

export const generateSourcesLoad = Batch.Contracts.generate<{
  compilation: {};
  contract: {
    sourcePath: string;
    source: string;
  };
  resources: { source: IdObject<DataModel.Source> };
  entry: DataModel.SourceInput;
  result: IdObject<DataModel.Source>;
}>({
  extract<_I>({ input: { sourcePath, source: contents } }) {
    return { sourcePath, contents };
  },

  *process({ entries }) {
    return yield* resources.load("sources", entries);
  },

  convert<_I, _O>({ result: source, input: contract }) {
    return {
      ...contract,
      db: {
        ...contract.db,
        source
      }
    };
  }
});
