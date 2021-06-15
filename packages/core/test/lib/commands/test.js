const assert = require("chai").assert;
const { default: Box } = require("@truffle/box");
const {
  determineTestFilesToRun
} = require("../../../lib/commands/test/determineTestFilesToRun");
const Artifactor = require("@truffle/artifactor");
const Resolver = require("@truffle/resolver");
const MemoryStream = require("memorystream");
const path = require("path");
const fs = require("fs-extra");
const glob = require("glob");
const WorkflowCompile = require("@truffle/workflow-compile");
const Test = require("../../../lib/testing/Test");

let config;
output = "";

function updateFile(filename) {
  const fileToUpdate = path.resolve(
    path.join(config.contracts_directory, filename)
  );

  // Update the modification time to simulate an edit.
  const newTime = new Date().getTime();
  fs.utimesSync(fileToUpdate, newTime, newTime);
}

describe("test command", () => {
  let memStream;

  before("Create a sandbox", async () => {
    config = await Box.sandbox("default");
    config.resolver = new Resolver(config);
    config.artifactor = new Artifactor(config.contracts_build_directory);
    config.networks = {
      default: {
        network_id: "1"
      },
      secondary: {
        network_id: "12345"
      }
    };
    config.network = "default";
    config.logger = { log: val => val && memStream.write(val) };
  });

  beforeEach(() => {
    memStream = new MemoryStream();
    memStream.on("data", data => {
      output += data.toString();
    });
  });

  after("Cleanup tmp files", () => {
    const files = glob.sync("tmp-*");
    files.forEach(file => fs.removeSync(file));
  });

  afterEach("Clear MemoryStream", () => (output = ""));

  it("Check test with subdirectories", () => {
    let testFiles = determineTestFilesToRun({ config });
    let testFilesCount = testFiles.length;

    let filename = path.join(
      config.test_directory,
      "sub_directory",
      "test.sol"
    );
    fs.createFileSync(filename);

    filename = path.join(config.test_directory, "sub_directory", "test.js");
    fs.createFileSync(filename);

    filename = path.join(
      config.test_directory,
      "sub_directory",
      "sub_sub_directory",
      "test.js"
    );
    fs.createFileSync(filename);

    let dirName = path.join(
      config.test_directory,
      "sub_directory",
      "empty_sub_directory"
    );

    // Create empty subdirectory to check if
    // determineTestFilesTo run function can process it without crashing
    fs.ensureDirSync(dirName);

    let newTestFiles = determineTestFilesToRun({ config });
    assert.equal(
      newTestFiles.length,
      testFilesCount + 3,
      "Wrong number of files discovered"
    );
  });

  it("runs test with --compile-none flag", async () => {
    const solidityTestFiles = [];
    const { contracts } = await Test.compileContractsWithTestFilesIfNeeded(
      solidityTestFiles,
      config.with({
        all: false,
        compileNone: true,
        quiet: false,
        test_files: solidityTestFiles
      }),
      config.resolver
    );
    assert.equal(
      contracts.length,
      0,
      "It should try to compile 0 contracts With compileNone == false"
    );
  });

  it("can run test WITHOUT --compile-none flag", async () => {
    const solidityTestFiles = [];
    const { contracts } = await Test.compileContractsWithTestFilesIfNeeded(
      solidityTestFiles,
      config.with({
        all: false,
        compileNone: false,
        quiet: false,
        test_files: solidityTestFiles
      }),
      config.resolver
    );
    assert.equal(
      contracts.length,
      3,
      "It should compile 3 contracts With compileNone == true"
    );
  });

  it("compiles all initial contracts", async () => {
    const { contracts } = await WorkflowCompile.compile(
      config.with({
        all: false,
        quiet: true
      })
    );
    assert.equal(
      Object.keys(contracts).length,
      0,
      "Should compile zero contracts. Test command was run before and everything should be up to date"
    );
  });

  it("run test without --compile-none flag after running build", async () => {
    const solidityTestFiles = [];
    const { contracts } = await Test.compileContractsWithTestFilesIfNeeded(
      solidityTestFiles,
      config.with({
        all: false,
        compileNone: false,
        quiet: false,
        test_files: solidityTestFiles
      }),
      config.resolver
    );
    assert.equal(
      contracts.length,
      0,
      "It should try to compile 0 contracts With compileNone == false. Because there are no updated files."
    );
  });

  it("runs test after updating one contract.", async () => {
    updateFile("ConvertLib.sol");

    const solidityTestFiles = [];

    const { contracts } = await Test.compileContractsWithTestFilesIfNeeded(
      solidityTestFiles,
      config.with({
        all: false,
        compileNone: false,
        quiet: false,
        test_files: solidityTestFiles
      }),
      config.resolver
    );
    assert.equal(
      contracts.length,
      2,
      "It should compile 2 files, updated file and its ancestor,  and --compile-none is not set."
    );
  });

  it("Update all contracts and build it.", async () => {
    updateFile("ConvertLib.sol");
    updateFile("MetaCoin.sol");
    updateFile("Migrations.sol");

    const { contracts } = await WorkflowCompile.compile(
      config.with({
        all: false,
        quiet: false
      })
    );
    assert.equal(
      Object.keys(contracts).length,
      3,
      "Should compile 3 contracts."
    );
  });

  it("Check if  files are picked from subdirectories in test directory.", async () => {
    // This allows to create customized directory structure to test more than one level of sub directories.
    let fileStructrure = {
      name: "sub_directory",
      files: ["test1.sol", "test2.js"],
      subdirs: [
        {
          name: "sub_sub_directory",
          files: ["test3.sol", "test4.js"]
        },
        {
          name: "sub_sub_directory2",
          files: ["test5.js", "test6.sol", "test7.sol"],
          subdirs: [
            {
              name: "one_more_sub",
              files: [
                "test8.sol",
                "test9.sol",
                "test10.sol",
                "test10.sol",
                "test11.sol"
              ]
            },
            {
              name: "one_more_sub2",
              files: [
                "test12.sol",
                "test13.sol",
                "test14.sol",
                "test14.sol",
                "test15.sol"
              ],
              subdirs: [
                {
                  name: "solidity_only_subdir",
                  files: ["test16.sol", "test17.sol", "test18.sol"]
                },
                {
                  name: "js_only_subdir",
                  files: ["test19.js", "test19.js", "test20.js"]
                },
                {
                  name: "empty_sub_sub_directory",
                  files: []
                }
              ]
            }
          ]
        }
      ]
    };

    // Create file in recursion. Used instead foreach since foreach loop doesn't wait for files to be created
    // Function does not count already existing files.
    function createFile(dirName, files, index) {
      // return zero if there are no files to create
      if (!files[index]) return 0;
      var fileName = path.join(dirName, files[index]);
      let filesCount = 0;
      if (!fs.existsSync(fileName)) {
        fs.createFileSync(fileName);
        filesCount++;
      }
      if (files.length > index + 1) {
        filesCount += createFile(dirName, files, index + 1);
      }

      return filesCount;
    }

    // Create files using dirStruct object. Count newly created files and skip existing files.
    // Returns number of new files.
    function createTestSubDir(dirName, dirStruct) {
      var numOfFiles = 0;

      numOfFiles = createFile(dirName, dirStruct.files, 0);

      if (dirStruct.subdirs) {
        dirStruct.subdirs.forEach(val => {
          numOfFiles += createTestSubDir(
            path.join(dirName, dirStruct.name, val.name),
            val
          );
        });
      }
      return numOfFiles;
    }

    // Call method used by Test to discover existing test files. Then create subdirectories and test files in these
    // subdirectories. Then run Test method again and check if number discovered increased.
    let testFiles = determineTestFilesToRun({ config });
    const testFilesCount = testFiles.length;

    const newTestFiles = createTestSubDir(
      config.test_directory,
      fileStructrure
    );

    testFiles = determineTestFilesToRun({ config });
    assert.equal(
      testFiles.length,
      testFilesCount + newTestFiles,
      "Wrong number of files discovered"
    );
  });
}).timeout(1000);
