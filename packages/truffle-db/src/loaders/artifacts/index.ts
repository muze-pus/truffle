import gql from "graphql-tag";
import { TruffleDB } from "truffle-db/db";
import * as Contracts from "truffle-workflow-compile";
import { generateId } from "truffle-db/helpers";
import { ContractObject } from "truffle-contract-schema/spec";

const AddBytecodes = gql`
input BytecodeInput {
  bytes: Bytes!
}

mutation AddBytecodes($bytecodes: [BytecodeInput!]!) {
  workspace {
    bytecodesAdd(input: {
      bytecodes: $bytecodes
    }) {
      bytecodes {
        id
      }
    }
  }
}`;

const AddSources = gql`
input SourceInput {
  contents: String!
  sourcePath: String
}

mutation AddSource($sources: [SourceInput!]!) {
  workspace {
    sourcesAdd(input: {
      sources: $sources
    }) {
      sources {
        id
        contents
        sourcePath
      }
    }
  }
}`;

const AddCompilation = gql`
input CompilerInput {
  name: String
  version: String
  settings: Object
}

input CompilationSourceInput {
  id: ID!
}

input CompilationSourceContractSourceInput {
  id: ID!
}

input CompilationSourceContractAstInput {
  json: String!
}

input CompilationSourceContractInput {
  name: String
  source: CompilationSourceContractSourceInput
  ast: CompilationSourceContractAstInput
}

input CompilationInput {
    compiler: CompilerInput!
    contracts: [CompilationSourceContractInput!]
    sources: [CompilationSourceInput!]!
}
input CompilationsAddInput {
  compilations: [CompilationInput!]!
}


mutation AddCompilation($compilations: [CompilationInput!]!) {
  workspace {
    compilationsAdd(input: {
      compilations: $compilations
    }) {
      compilations {
        id
        compiler {
          name
          version
        }
        contracts {
          name
          source {
            contents
            sourcePath
          }
          ast {
            json
          }
        }
        sources {
          contents
          sourcePath
        }
      }
    }
  }
}
`;

const AddContracts = gql`
  input AbiInput {
    json: String!
    items: [String]
  }
  input ContractCompilationInput {
    id: ID!
  }
  input ContractSourceContractInput {
    index: FileIndex
  }
  input ContractConstructorBytecodeInput {
    id: ID!
  }
  input ContractConstructorInput {
    createBytecode: ContractConstructorBytecodeInput!
  }
  input ContractInput {
    name: String
    abi: AbiInput
    compilation: ContractCompilationInput
    sourceContract: ContractSourceContractInput
    constructor: ContractConstructorInput
  }
  mutation AddContracts($contracts: [ContractInput!]!) {
    workspace {
      contractsAdd(input: {
        contracts: $contracts
      }) {
        contracts {
          id
          name
          abi {
            json
          }
          sourceContract {
            name
            source {
              contents
              sourcePath
            }
            ast {
              json
            }
          }
          compilation {
            compiler {
              name
              version
            }
            contracts {
              name
              source {
                contents
                sourcePath
              }
              ast {
                json
              }
            }
            sources {
              contents
              sourcePath
            }
          }
          constructor {
            createBytecode {
              bytes
            }
          }
        }
      }
    }
  }
`;

type WorkflowCompileResult = {
  outputs: { [compilerName: string]: string[] },
  contracts: { [contractName: string]: ContractObject }
};

export class ArtifactsLoader {
  private db: TruffleDB;
  private config: object;

  constructor (db: TruffleDB, config?: object) {
    this.db = db;
    this.config = config;
  }

  async load (): Promise<void> {
    await this.loadCompilation(this.config);
  }

  async loadCompilationContracts(compilation: object, compilationId: string) {
    let contracts = [];
    let contractIds = [];
    for(let contract in compilation) {
      let contractObject = {
        name: compilation[contract]["contract_name"],
        abi: {
          json: JSON.stringify(compilation[contract]["abi"])
        },
        compilation: {
          id: compilationId
        },
        sourceContract: {
          index: +contract
        },
        constructor: {
          createBytecode: { id: generateId({ bytes: compilation[contract]["bytecode"] }) }
        }
      };

      contracts.push(contractObject);
    }

    await this.db.query(AddContracts, { contracts });

  }
  async loadCompilationBytecodes(contracts: Array<ContractObject>) {
    // transform contract objects into data model bytecode inputs
    // and run mutation
    const result = await this.db.query(AddBytecodes, {
      bytecodes: contracts.map(
        ({ bytecode }) => ({ bytes: bytecode })
      )
    });
  }

  async loadCompilationSources(contracts: Array<ContractObject>) {
    // transform contract objects into data model source inputs
    // and run mutation
    const result = await this.db.query(AddSources, {
      sources: contracts.map(
        ({ source, sourcePath }) => ({ contents: source, sourcePath })
      )
    });

    // extract sources
    const sources = result.data.workspace.sourcesAdd.sources;

    // return only array of objects { id }
    return sources.map( ({ id }) => ({ id }) );
  }

  async compilationSourceContracts(compilation: object) {
    let sourceContracts = [];
    for(let contract in compilation) {
      let sourceContract =
      {
        name: compilation[contract]["contract_name"],
        source: {
          id: generateId({
            contents: compilation[contract]["source"],
            sourcePath: compilation[contract]["sourcePath"]
          })
        }
      }
      if(compilation[contract]["ast"]) {
        sourceContract["ast"] = {
          json: JSON.stringify(compilation[contract]["ast"])
        }
      }
      sourceContracts.push(sourceContract);
    }

    return sourceContracts;
  }

  async organizeContractsByCompiler (result: WorkflowCompileResult) {
    const { outputs, contracts } = result;

    return Object.entries(outputs)
      .map( ([compilerName, sourcePaths]) => ({
        [compilerName]: sourcePaths.map(
          (sourcePath) => Object.values(contracts)
            .filter( (contract) => contract.sourcePath === sourcePath)
            [0] || undefined
        )
      }))
      .reduce((a, b) => ({ ...a, ...b }), {});
  }

  async setCompilation(organizedCompilation: Array<ContractObject>) {
    const sourceContracts = await this.compilationSourceContracts(organizedCompilation);
    const sourceIds = await this.loadCompilationSources(organizedCompilation);
    const compilationObject = {
      compiler: {
        name: organizedCompilation[0]["compiler"]["name"],
        version: organizedCompilation[0]["compiler"]["version"]
      },
      contracts: sourceContracts,
      sources: sourceIds
    }

    return compilationObject;
  }

  async loadCompilation(compilationConfig: object) {
    const compilationOutput = await Contracts.compile(compilationConfig);
    const contracts = await this.organizeContractsByCompiler(compilationOutput);

    const compilationObjects = await Promise.all(Object.values(contracts)
      .filter(contractsArray => contractsArray.length > 0)
      .map(contractsArray =>
        this.setCompilation(contractsArray))
    );


    const compilations = await this.db.query(AddCompilation, { compilations: compilationObjects });

    //map contracts to the compilation they belong in before adding them to truffle-db
    await Promise.all(compilations.data.workspace.compilationsAdd.compilations
      .map(({ compiler, id }) => this.loadCompilationContracts(contracts[compiler.name], id) ));
  }
}
