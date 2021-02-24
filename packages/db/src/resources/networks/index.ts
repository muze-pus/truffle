import { logger } from "@truffle/db/logger";
const debug = logger("db:resources:networks");

import gql from "graphql-tag";

import type { Definition } from "../types";

import { resolveAncestors, resolveDescendants } from "./resolveRelations";
import {
  resolvePossibleAncestors,
  resolvePossibleDescendants
} from "./resolvePossibleRelations";

export const networks: Definition<"networks"> = {
  names: {
    resource: "network",
    Resource: "Network",
    resources: "networks",
    Resources: "Networks",
    resourcesMutate: "networksAdd",
    ResourcesMutate: "NetworksAdd"
  },
  createIndexes: [
    { fields: ["networkId"] },
    { fields: ["historicBlock.height"] },
    { fields: ["networkId", "historicBlock.height"] }
  ],
  idFields: ["networkId", "historicBlock"],
  typeDefs: gql`
    type Network implements Resource & Named {
      name: String!
      networkId: NetworkId!
      historicBlock: Block!

      genesis: Network!

      ancestors(
        limit: Int # default all
        minimumHeight: Int # default any height
        includeSelf: Boolean # default false
        onlyEarliest: Boolean # default false
        batchSize: Int # default 10
      ): [Network!]!

      descendants(
        limit: Int # default all
        maximumHeight: Int # default no height
        includeSelf: Boolean # default false
        onlyLatest: Boolean # default false
        batchSize: Int # default 10
      ): [Network!]!

      possibleAncestors(
        alreadyTried: [ID]!
        limit: Int # will default to 5
        disableIndex: Boolean # for internal use
      ): CandidateSearchResult!

      possibleDescendants(
        alreadyTried: [ID]!
        limit: Int # will default to 5
        disableIndex: Boolean # for internal use
      ): CandidateSearchResult!
    }

    scalar NetworkId

    type Block {
      height: Int!
      hash: String!
    }

    input NetworkInput {
      name: String!
      networkId: NetworkId!
      historicBlock: BlockInput!
    }

    input BlockInput {
      height: Int!
      hash: String!
    }

    type CandidateSearchResult {
      networks: [Network!]!
      alreadyTried: [ID!]! #will include all networks returned
    }
  `,
  resolvers: {
    Network: {
      genesis: {
        async resolve(network, _, context) {
          debug("Resolving Network.genesis...");
          const results = await resolveAncestors(
            network,
            { onlyEarliest: true, includeSelf: true },
            context
          );
          const result = results[results.length - 1];
          if (!result || result.historicBlock.height !== 0) {
            throw new Error(
              `No known genesis for network with ID: ${network.id}`
            );
          }
          debug("Resolved Network.genesis.");
          return result;
        }
      },

      ancestors: {
        async resolve(network, options, context) {
          debug("Resolving Network.ancestors...");
          const result = await resolveAncestors(network, options, context);
          debug("Resolved Network.ancestors.");
          return result;
        }
      },

      descendants: {
        async resolve(network, options, context) {
          debug("Resolving Network.descendants...");
          const result = await resolveDescendants(network, options, context);
          debug("Resolved Network.descendants.");
          return result;
        }
      },

      possibleAncestors: {
        async resolve(network, options, context) {
          debug("Resolving Network.possibleAncestors...");
          const result = await resolvePossibleAncestors(
            network,
            options,
            context
          );
          debug("Resolved Network.possibleAncestors.");
          return result;
        }
      },

      possibleDescendants: {
        async resolve(network, options, context) {
          debug("Resolving Network.possibleDescendants...");
          const result = await resolvePossibleDescendants(
            network,
            options,
            context
          );
          debug("Resolved Network.possibleDescendants.");
          return result;
        }
      }
    },
    CandidateSearchResult: {
      networks: {
        resolve: async (parent, __, {}) => {
          return parent.networks;
        }
      },
      alreadyTried: {
        resolve: (parent, __, {}) => {
          return parent.alreadyTried;
        }
      }
    }
  }
};
