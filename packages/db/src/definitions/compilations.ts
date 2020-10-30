import { logger } from "@truffle/db/logger";
const debug = logger("db:definitions:compilations");

import gql from "graphql-tag";

import { Definition } from "./types";

export const compilations: Definition<"compilations"> = {
  createIndexes: [],
  idFields: ["compiler", "sources"],
  typeDefs: gql`
    type Compilation implements Resource {
      id: ID!
      compiler: Compiler!
      sources: [Source]!
      processedSources: [ProcessedSource]!
      sourceMaps: [SourceMap]
      contracts: [Contract]!
    }

    type Compiler {
      name: String!
      version: String!
      settings: CompilerSettings
    }

    scalar CompilerSettings

    type ProcessedSource {
      source: Source!
      contracts: [Contract]!
      ast: AST
    }

    type AST {
      json: String!
    }

    type SourceMap {
      json: String!
    }

    input CompilationInput {
      compiler: CompilerInput!
      processedSources: [ProcessedSourceInput!]
      sources: [ResourceReferenceInput!]!
      sourceMaps: [SourceMapInput]
    }

    input CompilerInput {
      name: String!
      version: String!
      settings: CompilerSettings
    }

    input ProcessedSourceInput {
      name: String
      source: ResourceReferenceInput
      ast: ASTInput
    }

    input ASTInput {
      json: String!
    }

    input SourceMapInput {
      json: String!
    }
  `,
  resolvers: {
    Compilation: {
      sources: {
        resolve: async ({ sources }, _, { workspace }) => {
          debug("Resolving Compilation.sources...");

          const result = await Promise.all(
            sources.map(({ id }) => workspace.get("sources", id))
          );

          debug("Resolved Compilation.sources.");
          return result;
        }
      },
      processedSources: {
        resolve: ({ id, processedSources }, _, {}) => {
          debug("Resolving Compilation.processedSources...");

          const result = processedSources.map((processedSource, index) => ({
            ...processedSource,
            compilation: { id },
            index
          }));

          debug("Resolved Compilation.processedSources.");
          return result;
        }
      },
      contracts: {
        resolve: async ({ id }, _, { workspace }) => {
          debug("Resolving Compilation.contracts...");

          const result = await workspace.find("contracts", {
            selector: {
              "compilation.id": id
            }
          });

          debug("Resolved Compilation.contracts.");
          return result;
        }
      }
    },

    ProcessedSource: {
      source: {
        resolve: async ({ source: { id } }, _, { workspace }) => {
          debug("Resolving ProcessedSource.source...");

          const result = await workspace.get("sources", id);

          debug("Resolved ProcessedSource.source.");
          return result;
        }
      },
      contracts: {
        resolve: async ({ compilation, index }, _, { workspace }) => {
          debug("Resolving ProcessedSource.compilation...");

          const result = await workspace.find("contracts", {
            selector: {
              "compilation.id": compilation.id,
              "processedSource.index": index
            }
          });

          debug("Resolved ProcessedSource.compilation.");
          return result;
        }
      }
    }
  }
};
