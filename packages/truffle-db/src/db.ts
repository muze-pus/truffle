import {
  GraphQLSchema,
  DocumentNode,
  parse,
  execute
} from "graphql";

import { schema } from "truffle-db/data";

import { Workspace } from "truffle-db/workspace";

interface IConfig {
  contracts_build_directory: string,
  working_directory?: string
}

interface IContext {
  artifactsDirectory: string,
  workingDirectory: string,
  workspace: Workspace
}

export class TruffleDB {
  schema: GraphQLSchema;
  context: IContext;

  constructor (config: IConfig) {
    this.context = TruffleDB.createContext(config);
    this.schema = schema;
  }

  async query (
    query: DocumentNode | string,
    variables: any = {}
  ):
    Promise<any>
  {
    const document: DocumentNode =
      (typeof query !== "string")
        ? query
        : parse(query);

    return await execute(
      this.schema, document, null, this.context, variables
    );
  }

  static createContext(config: IConfig): IContext {
    return {
      workspace: new Workspace(),
      artifactsDirectory: config.contracts_build_directory,
      workingDirectory: config.working_directory || process.cwd()
    }
  }
}
