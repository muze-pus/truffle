import fs from "fs";
import path from "path";

import { TruffleDB } from "truffle-db";

const fixturesDirectory = path.join(
  __dirname, // truffle-db/src/test
  "..", // truffle-db/src/
  "..", // truffle-db/
  "test",
  "fixtures"
);

// minimal config
const config = {
  contracts_build_directory: fixturesDirectory
};

const db = new TruffleDB(config);
const Migrations = require(path.join(fixturesDirectory, "Migrations.json"));

const GetContractNames = `
query GetContractNames {
  artifacts {
    contractNames
  }
}
`;

const GetContract = `
query GetContract($name:String!) {
  artifacts {
    contract(name:$name) {
      name
      sourceContract {
        name
        source {
          contents
          sourcePath
        }
        ast
      }
      abi {
        json
      }
    }
  }
}`;

const GetContractConstructor = `
query getContractConstructor($name:String!) {
  artifacts {  
    contractConstructor(name: $name) {
      contract {
        name
        sourceContract {
          name
          source {
            contents
            sourcePath
          }
        }
        abi {
          json
        }
      }
      createBytecode {
        bytes
      }
    }  
  }
}`;

it("lists artifact contract names", async () => {
  const result = await db.query(GetContractNames);
  expect(result).toHaveProperty("data");

  const { data } = result;
  expect(data).toHaveProperty("artifacts");

  const { artifacts } = data;
  expect(artifacts).toHaveProperty("contractNames");

  const { contractNames } = artifacts;
  expect(contractNames).toContain("Migrations");
});

it("retrieves contract correctly", async () => {
  const result = await db.query(GetContract, {
    name: Migrations.contractName
  });

  const { data } = result;
  expect(data).toHaveProperty("artifacts");

  const { artifacts } = data;
  expect(artifacts).toHaveProperty("contract");

  const { contract } = artifacts;
  expect(contract).toHaveProperty("name");
  expect(contract).toHaveProperty("sourceContract");

  const { name, sourceContract, abi } = contract;
  expect(name).toEqual(Migrations.contractName);
  expect(sourceContract).toHaveProperty("name");
  expect(sourceContract).toHaveProperty("ast");
  expect(sourceContract).toHaveProperty("source");

  const { ast, source } = sourceContract; 
  expect(source).toHaveProperty("contents");
  expect(source).toHaveProperty("sourcePath");
});

it("retrieves contract constructor object correctly", async() => {
  const result = await db.query(GetContractConstructor, {
    name: Migrations.contractName
  });

  const { data } = result;
  expect(data).toHaveProperty("artifacts");

  const { artifacts } = data;
  expect(artifacts).toHaveProperty("contractConstructor");

  const { contractConstructor } = artifacts;
  expect(contractConstructor).toHaveProperty("contract");
  expect(contractConstructor).toHaveProperty("createBytecode");

  const { contract } = contractConstructor;
  expect(contract).toHaveProperty("name");
  expect(contract).toHaveProperty("abi");
  expect(contract).toHaveProperty("sourceContract");
});

