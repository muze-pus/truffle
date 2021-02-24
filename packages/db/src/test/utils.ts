import { logger } from "@truffle/db/logger";
const debug = logger("db:test:utils");

import path from "path";

import * as graphql from "graphql";

import { Workspace } from "@truffle/db/resources";
import { schema, attach } from "@truffle/db/system";
export { generateId } from "@truffle/db/system";

import tmp from "tmp";

export const fixturesDirectory = path.join(
  __dirname, // db/src/test
  "..", // db/src/
  "..", // db/
  "test",
  "fixtures"
);

const tempDir = tmp.dirSync({ unsafeCleanup: true });
tmp.setGracefulCleanup();

export class WorkspaceClient {
  private workspace: Workspace;

  constructor() {
    this.workspace = attach({
      adapter: {
        name: "sqlite",
        settings: {
          directory: tempDir.name
        }
      }
    });
  }

  async execute(request, variables = {}) {
    const result = await graphql.execute(
      schema,
      request,
      null, // root object, managed by workspace
      { workspace: this.workspace }, // context vars
      variables
    );

    if (result.errors) {
      debug("errors %o", result.errors);
    }

    return result.data;
  }
}

export const Migrations = require(path.join(
  fixturesDirectory,
  "Migrations.json"
));
