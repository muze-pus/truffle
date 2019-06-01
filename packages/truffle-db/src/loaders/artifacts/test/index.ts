import fs from "fs";
import path from "path";
import gql from "graphql-tag";
import { TruffleDB } from "truffle-db";
import { ArtifactsLoader } from "truffle-db/loaders/artifacts";
import { generateId } from "truffle-db/helpers";
import * as Contracts from "truffle-workflow-compile";

// mocking the truffle-workflow-compile to avoid jest timing issues
// and also to keep from adding more time to Travis testing
jest.mock("truffle-workflow-compile", () => ({
  compile: function(config, callback) {
    const magicSquare= require(path.join(__dirname, "sources", "MagicSquare.json"));
    const migrations = require(path.join(__dirname, "sources", "Migrations.json"));
    const squareLib = require(path.join(__dirname, "sources", "SquareLib.json"));
    const vyperStorage = require(path.join(__dirname, "sources", "VyperStorage.json"));
    const returnValue = {
      "outputs": {
        "solc": [
          "/Users/fainashalts/solidity-magic-square/contracts/MagicSquare.sol",
          "/Users/fainashalts/solidity-magic-square/contracts/Migrations.sol",
          "/Users/fainashalts/solidity-magic-square/contracts/SquareLib.sol"
        ],
        "vyper": [
           "/Users/fainashalts/truffle-six/testing2/contracts/VyperStorage.vy",
        ]
      },
      "contracts": [{
        "contract_name": "MagicSquare",
        ...magicSquare
      },
      {
        "contract_name": "Migrations",
        ...migrations
      },
      {
        "contract_name": "SquareLib",
        ...squareLib
      },
      {
        "contract_name": "VyperStorage",
        ...vyperStorage
      },
      ]
    }
    return returnValue;
  }
}));

const fixturesDirectory = path.join(__dirname, "sources");

// minimal config
const config = {
  contracts_build_directory: fixturesDirectory
};

const compilationConfig =  {
  contracts_directory: path.join(__dirname, "compilationSources"),
  contracts_build_directory: path.join(__dirname, "sources"),
  all: true
}

const db = new TruffleDB(config);
const Migrations = require(path.join(fixturesDirectory, "Migrations.json"));
const artifacts = [
  require(path.join(__dirname, "sources", "MagicSquare.json")),
  require(path.join(__dirname, "sources", "Migrations.json")),
  require(path.join(__dirname, "sources", "SquareLib.json")),
  require(path.join(__dirname, "sources", "VyperStorage.json")) ];

const GetWorkspaceBytecode: boolean = gql`
query GetWorkspaceBytecode($id: ID!) {
  workspace {
    bytecode(id: $id) {
      id
      bytes
    }
  }
}`;

const GetWorkspaceSource: boolean = gql`
query GetWorkspaceSource($id: ID!) {
  workspace {
    source(id: $id) {
      id
      contents
      sourcePath
    }
  }
}`;

const GetWorkspaceContract = gql`
query GetWorkspaceContract($id:ID!){
  workspace {
    contract(id:$id) {
      id
      name
      abi {
        json
      }
      constructor {
        createBytecode {
          bytes
        }
      }
      sourceContract {
        source {
          contents
          sourcePath
        }
        ast {
          json
        }
        source {
          contents
          sourcePath
        }
      }
      compilation {
        compiler {
          name
          version
        }
        sources {
          contents
          sourcePath
        }
        contracts {
          name
          source {
            contents
            sourcePath
          }
        }
      }
    }
  }
}`;

const GetWorkspaceCompilation: boolean = gql`
query getWorkspaceCompilation($id: ID!) {
  workspace {
    compilation(id: $id) {
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
        id
        contents
        sourcePath
      }
    }
  }
}`;

describe("Compilation", () => {
  let sourceIds= [];
  let bytecodeIds = [];
  let compilationIds = [];
  let expectedSolcCompilationId;
  let expectedVyperCompilationId;
  beforeAll(async () => {
    artifacts.map((contract) => {

      let sourceId = generateId({
        contents: contract["source"],
        sourcePath: contract["sourcePath"]
      });
      sourceIds.push({id: sourceId});

      let bytecodeId = generateId({
        bytes: contract["bytecode"]
      });
      bytecodeIds.push({ id: bytecodeId });
    });

    expectedSolcCompilationId = generateId({
      compiler: artifacts[0].compiler,
      sourceIds: [sourceIds[0], sourceIds[1], sourceIds[2]]
    });
    expectedVyperCompilationId = generateId({
      compiler: artifacts[3].compiler,
      sourceIds: [sourceIds[3]]
    });
    compilationIds.push({ id: expectedSolcCompilationId }, { id: expectedVyperCompilationId });

    const loader = new ArtifactsLoader(db, compilationConfig);
    await loader.load();
  });

  it("loads compilations", async () => {
    const compilationsQuery = await Promise.all(compilationIds.map(
      (compilationId) => {
        let compilation = db.query(GetWorkspaceCompilation, compilationId);
        return compilation;
    }));

    const solcCompilation = compilationsQuery[0].data.workspace.compilation;
    expect(solcCompilation.compiler.version).toEqual(artifacts[0].compiler.version);
    expect(solcCompilation.sources.length).toEqual(3);
    solcCompilation.sources.map((source, index)=> {
      expect(source.id).toEqual(sourceIds[index].id);
      expect(source["contents"]).toEqual(artifacts[index].source);
      expect(solcCompilation.contracts[index].name).toEqual(artifacts[index].contractName);
    });

    const vyperCompilation =  compilationsQuery[1].data.workspace.compilation
    expect(vyperCompilation.compiler.version).toEqual(artifacts[3].compiler.version);
    expect(vyperCompilation.sources.length).toEqual(1);
    expect(vyperCompilation.sources[0].id).toEqual(sourceIds[3].id);
    expect(vyperCompilation.sources[0].contents).toEqual(artifacts[3].source);
    expect(vyperCompilation.contracts[0].name).toEqual(artifacts[3].contractName);
  });

  it("loads contract sources", async () => {
    for(let index in sourceIds) {
      let {
        data: {
          workspace: {
            source: {
              contents,
              sourcePath
            }
          }
        }
      } = await db.query(GetWorkspaceSource, sourceIds[index]);

      expect(contents).toEqual(artifacts[index].source);
      expect(sourcePath).toEqual(artifacts[index].sourcePath);
    }
  });

  it("loads bytecodes", async () => {
    for(let index in bytecodeIds) {
      let {
        data: {
          workspace: {
            bytecode: {
              bytes
            }
          }
        }
      } = await db.query(GetWorkspaceBytecode, bytecodeIds[index]);

      expect(bytes).toEqual(artifacts[index].bytecode);

    }
  });

  it("loads contracts", async () => {
    let contractIds = [];

    for(let index in artifacts) {
      let expectedId = generateId({
        name: artifacts[index].contractName,
        abi: { json: JSON.stringify(artifacts[index].abi) },
        sourceContract: { index: artifacts[index].compiler.name === "solc" ? +index : 0},
        compilation: {
          id: artifacts[index].compiler.name === "solc" ? expectedSolcCompilationId : expectedVyperCompilationId
        }
      });

      contractIds.push({ id: expectedId });
      let {
        data: {
          workspace: {
            contract: {
              id,
              name,
              constructor: {
                createBytecode: {
                  bytes
                }
              },
              sourceContract: {
                source: {
                  contents
                }
              },
              compilation: {
                compiler: {
                  version
                }
              }
            }
          }
        }
      } = await db.query(GetWorkspaceContract, contractIds[index]);

      expect(name).toEqual(artifacts[index].contractName);
      expect(bytes).toEqual(artifacts[index].bytecode);
      expect(contents).toEqual(artifacts[index].source);
      expect(version).toEqual(artifacts[index].compiler.version);
      expect(id).toEqual(contractIds[index].id);
    }
  });
});
