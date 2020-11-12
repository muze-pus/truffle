import { logger } from "@truffle/db/logger";
const debug = logger("db:project:names:current");

import { IdObject, resources } from "@truffle/db/project/process";
import * as Batch from "./batch";

export const generateProjectNamesLoad = Batch.generate<{
  assignment: {
    name: string;
    type: string;
    nameRecord: IdObject<DataModel.NameRecord>;
  };
  properties: {
    projectName: IdObject<DataModel.ProjectName>;
  };
  entry: DataModel.ProjectNameInput;
  result: IdObject<DataModel.ProjectName>;
}>({
  extract<_I>({ input: { name, type, nameRecord }, inputs: { project } }) {
    return { project, name, type, nameRecord };
  },

  *process({ entries }) {
    return yield* resources.load("projectNames", entries);
  },

  convert<_I, _O>({ result, input }) {
    return {
      ...input,
      projectName: result
    };
  }
});
