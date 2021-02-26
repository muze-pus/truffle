/**
 * @category Internal processor
 * @packageDocumentation
 */
import { logger } from "@truffle/db/logger";
const debug = logger("db:project:loadMigrate:contractInstances");

import type { DataModel, Input, IdObject } from "@truffle/db/resources";
import { resources } from "@truffle/db/process";
import * as Batch from "./batch";

export const process = Batch.configure<{
  artifact: {
    db: {
      contract: IdObject<"contracts">;
      callBytecode: IdObject<"bytecodes">;
      createBytecode: IdObject<"bytecodes">;
    };
  };
  requires: {
    callBytecode?: {
      linkReferences: { name: string | null }[] | null;
    };
    createBytecode?: {
      linkReferences: { name: string | null }[] | null;
    };
    db?: {
      network: IdObject<"networks">;
    };
  };
  produces: {
    db?: {
      contractInstance: IdObject<"contractInstances">;
    };
  };
  entry: Input<"contractInstances"> | undefined;
  result: IdObject<"contractInstances"> | undefined;
}>({
  extract({ input, inputs, breadcrumb }) {
    const { artifacts } = inputs;
    const { artifactIndex } = breadcrumb;

    const artifact = artifacts[artifactIndex];

    const {
      address,
      transactionHash,
      links,
      callBytecode: { linkReferences: callLinkReferences = [] } = {},
      createBytecode: { linkReferences: createLinkReferences = [] } = {},
      db: { network } = {}
    } = input;

    if (!network) {
      return;
    }

    const {
      db: { contract, callBytecode, createBytecode }
    } = artifact;

    return {
      address,
      network,
      contract,
      callBytecode: link(callBytecode, callLinkReferences, links),
      creation: {
        transactionHash,
        constructor: {
          createBytecode: link(createBytecode, createLinkReferences, links)
        }
      }
    };
  },

  *process({ entries }) {
    return yield* resources.load("contractInstances", entries);
  },

  // @ts-ignore to overcome limitations in contract-schema
  convert({ result, input }) {
    return {
      ...input,
      db: {
        ...(input.db || {}),
        contractInstance: result
      }
    };
  }
});

function link(
  bytecode: IdObject<"bytecodes">,
  linkReferences: { name: string | null }[] | null,
  links?: { [name: string]: string }
): DataModel.LinkedBytecodeInput {
  if (!links) {
    return {
      bytecode,
      linkValues: []
    };
  }

  const linkValues = Object.entries(links).map(([name, value]) => ({
    value,
    linkReference: {
      bytecode,
      index: (linkReferences || []).findIndex(
        linkReference => name === linkReference.name
      )
    }
  }));

  return {
    bytecode,
    linkValues
  };
}
