const path = require("path");
const originalRequire = require("original-require");
const preserveCommand = require("../../../lib/commands/preserve");

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
const semver = require("semver");
chai.use(chaiAsPromised);
const { assert } = chai;

// Skip preserve tests on Node 10
const conditionalDescribe = semver.satisfies(process.version, ">=12")
  ? describe
  : describe.skip;

conditionalDescribe("preserve", () => {
  // Add mockPlugins folder to require path so stub plugins can be found
  originalRequire("app-module-path").addPath(
    path.resolve(__dirname, "../../mockPlugins")
  );

  // Options propagates to the truffle config object so these contain config properties as well
  const defaultOptions = {
    "plugins": ["dummy-loader", "dummy-recipe", "truffle-mock"],
    "working_directory": process.cwd(),
    "dummy-recipe": true,
    "_": ["./test/mockPlugins/dummy-loader"],
    "environments": {
      development: {
        "dummy-recipe": {
          selectedEnvironment: "development"
        }
      },
      production: {
        "dummy-recipe": {
          selectedEnvironment: "production"
        }
      }
    }
  };

  describe("help()", () => {
    it("should contain a flag for all tagged recipes (including defaults)", async () => {
      const help = await preserveCommand.help(defaultOptions);

      const expectedFlags = [
        {
          option: "--environment",
          description:
            "Environment name, as defined in truffle-config `environments` object"
        },
        {
          option: "--dummy-recipe",
          description: "Dummy Recipe"
        },
        {
          option: "--ipfs",
          description: "Preserve to IPFS"
        },
        {
          option: "--filecoin",
          description: "Preserve to Filecoin"
        },
        {
          option: "--buckets",
          description: "Preserve to Textile Buckets"
        }
      ];

      assert.deepEqual(help.options, expectedFlags);
    });
  });

  describe("run()", () => {
    it("should throw an error if an unknown environment was specified", async () => {
      const options = { ...defaultOptions, environment: "non-existent" };

      const expectedError = /Unknown environment: non-existent/;

      await assert.isRejected(preserveCommand.run(options), expectedError);
    });

    it("should throw an error if no valid recipe tag was specified", async () => {
      const options = { ...defaultOptions };
      delete options["dummy-recipe"];

      const expectedError = "No (valid) recipe specified";

      await assert.isRejected(preserveCommand.run(options), expectedError);
    });

    it("should throw an error if no target was specified", async () => {
      const options = { ...defaultOptions, _: [] };

      const expectedError = "No preserve target specified";

      await assert.isRejected(preserveCommand.run(options), expectedError);
    });

    it("should throw an error if no recipe dependency path can be found", async () => {
      const options = { ...defaultOptions, plugins: ["dummy-recipe"]};

      const expectedError = 'No plugins found that output the label "message".';

      await assert.isRejected(preserveCommand.run(options), expectedError);
    });

    describe("success", () => {
      const originalStdErrWrite = process.stderr.write;
      const originalConsoleLog = console.log;

      let output;
      const appendToOutput = message => {
        output += message + "\n";
      };

      // Redirect console output and spinnies output (stderr for some reason)
      beforeEach(() => {
        output = "";
        process.stderr.write = appendToOutput;
        console.log = appendToOutput;
      });

      afterEach(() => {
        // Reset logging functionss
        process.stderr.write = originalStdErrWrite;
        console.log = originalConsoleLog;
      });

      it("should call the preserve plugin with default environment options", async () => {
        const options = { ...defaultOptions };

        await preserveCommand.run(options);

        assert.include(output, "Provided path: ./test/mockPlugins/dummy-loader");
        assert.include(output, "Provided message: Hello World!");
        assert.include(output, "Provided environment name: development");
      });

      it("should call the preserve plugin with custom environment options", async () => {
        const options = { ...defaultOptions, environment: "production" };

        await preserveCommand.run(options);

        assert.include(output, "Provided path: ./test/mockPlugins/dummy-loader");
        assert.include(output, "Provided message: Hello World!");
        assert.include(output, "Provided environment name: production");
      });
    });
  });
});
