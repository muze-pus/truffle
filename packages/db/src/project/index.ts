import { logger } from "@truffle/db/logger";
const debug = logger("db:project");

import type { Provider } from "web3/providers";
import { WorkflowCompileResult } from "@truffle/compile-common";
import { ContractObject } from "@truffle/contract-schema/spec";

import { Db, toIdObject, IdObject } from "@truffle/db/meta";

import { generateInitializeLoad } from "./initialize";
import { generateNamesLoad } from "./names";

import {
  generateCompileLoad,
  generateMigrateLoad
} from "@truffle/db/loaders/commands";

import { ProcessorRunner, forDb } from "./process";

/**
 * Interface between @truffle/db and Truffle-at-large. Accepts external
 * Truffle concepts such as compilation results and migrated artifacts.
 */
export class Project {
  /**
   * Construct abstraction and idempotentally add a project resource
   */
  static async initialize(options: {
    db: Db;
    project: DataModel.ProjectInput;
  }): Promise<Project> {
    const { db, project: input } = options;

    const { run, forProvider } = forDb(db);

    const project = await run(generateInitializeLoad, input);

    return new Project({ run, forProvider, project });
  }

  /**
   * Accept a compilation result and process it to save all relevant resources
   * (Source, Bytecode, Compilation, Contract)
   */
  async loadCompile(options: {
    result: WorkflowCompileResult;
  }): Promise<{
    contracts: IdObject<DataModel.Contract>[];
  }> {
    const { result } = options;

    const { contracts } = await this.run(generateCompileLoad, result);

    return {
      contracts: contracts.map(toIdObject)
    };
  }

  /**
   * Update name pointers for this project. Currently affords name-keeping for
   * Network and Contract resources (e.g., naming ContractInstance resources
   * is not supported directly)
   *
   * This saves NameRecord and ProjectName resources to @truffle/db.
   *
   * Returns a list NameRecord resources for completeness, although these may
   * be regarded as an internal concern. ProjectName resources are not returned
   * because they are mutable; returned representations would be impermanent.
   */
  async assignNames(options: {
    assignments: {
      [collectionName: string]: IdObject[];
    };
  }): Promise<{
    assignments: {
      [collectionName: string]: IdObject<DataModel.NameRecord>[];
    };
  }> {
    const { assignments } = await this.run(generateNamesLoad, {
      project: this.project,
      assignments: options.assignments
    });
    return {
      assignments: Object.entries(assignments)
        .map(([collectionName, assignments]) => ({
          [collectionName]: assignments.map(({ nameRecord }) => nameRecord)
        }))
        .reduce((a, b) => ({ ...a, ...b }), {})
    };
  }

  /**
   * Accept a provider to enable workflows that require communicating with the
   * underlying blockchain network.
   */
  connect(options: { provider: Provider }): ConnectedProject {
    const { run } = this.forProvider(options.provider);

    return new ConnectedProject({
      run,
      project: this.project
    });
  }

  /*
   * internals
   */

  protected run: ProcessorRunner;
  private forProvider: (provider: Provider) => { run: ProcessorRunner };
  private project: IdObject<DataModel.Project>;

  protected constructor(options: {
    project: IdObject<DataModel.Project>;
    run: ProcessorRunner;
    forProvider?: (provider: Provider) => { run: ProcessorRunner };
  }) {
    this.project = options.project;
    this.run = options.run;
    if (options.forProvider) {
      this.forProvider = options.forProvider;
    }
  }
}

class ConnectedProject extends Project {
  /**
   * Process artifacts after a migration. Uses provider to determine most
   * relevant network information directly, but still requires project-specific
   * information about the network (i.e., name)
   *
   * This adds potentially multiple Network resources to @truffle/db, creating
   * individual networks for the historic blocks in which each ContractInstance
   * was first created on-chain.
   *
   * This saves Network and ContractInstance resources to @truffle/db.
   *
   * Returns both a list of ContractInstances and the Network added with the
   * highest block height.
   */
  async loadMigrate(options: {
    network: Omit<DataModel.NetworkInput, "networkId" | "historicBlock">;
    artifacts: ContractObject[];
  }): Promise<{
    network: IdObject<DataModel.Network>;
    contractInstances: IdObject<DataModel.ContractInstance>[];
  }> {
    const { network, contractInstances } = await this.run(
      generateMigrateLoad,
      options
    );

    return { network, contractInstances };
  }
}
