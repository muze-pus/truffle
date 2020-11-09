import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:schema:artifactsLoader");

import { TruffleDB } from "@truffle/db/db";
import { IdObject, toIdObject } from "@truffle/db/meta";
import Config from "@truffle/config";
import TruffleResolver from "@truffle/resolver";
import type { Resolver } from "@truffle/resolver";
import { Environment } from "@truffle/environment";
import { ContractObject } from "@truffle/contract-schema/spec";

import { Project } from "@truffle/db/loaders/project";
import { FindContracts } from "@truffle/db/loaders/resources/contracts";
import { WorkflowCompileResult } from "@truffle/compile-common/src/types";
import WorkflowCompile from "@truffle/workflow-compile";

export class ArtifactsLoader {
  private db: TruffleDB;
  private compilationConfig: Partial<Config>;
  private resolver: Resolver;

  constructor(db: TruffleDB, config?: Partial<Config>) {
    this.db = db;
    this.compilationConfig = config;
    // @ts-ignore
    this.resolver = new TruffleResolver(config);
  }

  async load(): Promise<void> {
    debug("Compiling...");
    const result: WorkflowCompileResult = await WorkflowCompile.compile(
      this.compilationConfig
    );
    debug("Compiled.");

    debug("Initializing project...");
    const project = await Project.initialize({
      project: {
        directory: this.compilationConfig.working_directory
      },
      db: this.db
    });
    debug("Initialized project.");

    debug("Loading compilations...");
    const { contracts } = await project.loadCompile({ result });
    debug("Loaded compilations.");

    debug("Assigning contract names...");
    await project.assignNames({ assignments: { contracts } });
    debug("Assigned contract names.");

    const artifacts = await this.collectArtifacts(contracts);

    const config = Config.detect({
      working_directory: this.compilationConfig["contracts_directory"]
    });

    debug("Loading networks...");
    const networks = [];
    for (const name of Object.keys(config.networks)) {
      try {
        debug("Connecting to network name: %s", name);
        config.network = name;
        await Environment.detect(config);

        const result = await project
          .connect({ provider: config.provider })
          .loadMigrate({
            network: { name },
            artifacts
          });

        networks.push(result.network);
      } catch (error) {
        debug("error %o", error);
        continue;
      }
    }
    debug("Loaded networks.");

    debug("Assigning network names...");
    await project.assignNames({ assignments: { networks } });
    debug("Assigned network names.");
  }

  private async collectArtifacts(
    contractIdObjects: IdObject<DataModel.Contract>[]
  ): Promise<ContractObject[]> {
    // get full representation
    debug(
      "Retrieving contracts, ids: %o...",
      contractIdObjects.map(({ id }) => id)
    );
    const {
      data: { contracts }
    } = await this.db.execute(FindContracts, {
      ids: contractIdObjects.map(({ id }) => id)
    });
    debug(
      "Retrieved contracts, ids: %o.",
      contractIdObjects.map(({ id }) => id)
    );

    // and resolve artifact
    return contracts.map((contract: DataModel.Contract) => {
      const { name } = contract;

      debug("Requiring artifact for %s...", name);
      // @ts-ignore
      const artifact: ContractObject = this.resolver.require(name)._json;
      debug("Required artifact for %s.", name);

      artifact.db = {
        contract: toIdObject(contract)
      };

      return artifact;
    });
  }
}
