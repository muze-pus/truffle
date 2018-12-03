const TestCase = require("mocha/lib/test.js");
const Suite = require("mocha/lib/suite.js");
const Deployer = require("truffle-deployer");
const find_contracts = require("truffle-contract-sources");
const compile = require("truffle-compile");
const abi = require("web3-eth-abi");
const series = require("async").series;
const path = require("path");
const semver = require("semver");

let SafeSend;

const SolidityTest = {
  define(abstraction, dependency_paths, runner, mocha) {
    const self = this;

    const suite = new Suite(abstraction.contract_name, {});
    suite.timeout(runner.BEFORE_TIMEOUT);

    // Set up our runner's needs first.
    suite.beforeAll("prepare suite", function(done) {
      series(
        [
          runner.initialize.bind(runner),
          self.compileNewAbstractInterface.bind(this, runner),
          self.deployTestDependencies.bind(
            this,
            abstraction,
            dependency_paths,
            runner
          )
        ],
        done
      );
    });

    suite.beforeEach("before test", function(done) {
      runner.startTest(this, done);
    });

    // Function that decodes raw logs from unlinked third party assertion
    // libraries and returns usable TestEvent logs
    function decodeTestEvents(result) {
      if (result.logs.length) return result.logs;

      const logs = [];
      const signature = web3.utils.sha3("TestEvent(bool,string)");

      result.receipt.logs.forEach(log => {
        if (log.topics.length === 2 && log.topics[0] === signature) {
          const decoded = {
            event: "TestEvent",
            args: {
              result: abi.decodeLog(["bool"], log.topics[1], log.topics)[0],
              message: abi.decodeLog(["string"], log.data, log.topics)[0]
            }
          };
          logs.push(decoded);
        }
      });
      return logs;
    }

    // Function that checks transaction logs to see if a test failed.
    function processResult(result) {
      result.logs = decodeTestEvents(result);

      result.logs.forEach(log => {
        if (log.event === "TestEvent" && !log.args.result)
          throw new Error(log.args.message);
      });
    }

    // Add functions from test file.
    abstraction.abi.forEach(item => {
      if (item.type !== "function") return;

      ["beforeAll", "beforeEach", "afterAll", "afterEach"].forEach(fn_type => {
        if (item.name.indexOf(fn_type) === 0) {
          suite[fn_type](item.name, () => {
            return abstraction
              .deployed()
              .then(deployed => {
                return deployed[item.name]();
              })
              .then(processResult);
          });
        }
      });

      if (item.name.indexOf("test") === 0) {
        const test = new TestCase(item.name, () => {
          return abstraction
            .deployed()
            .then(deployed => {
              return deployed[item.name]();
            })
            .then(processResult);
        });

        test.timeout(runner.TEST_TIMEOUT);
        suite.addTest(test);
      }
    });

    suite.afterEach("after test", function(done) {
      runner.endTest(this, done);
    });

    mocha.suite.addSuite(suite);
  },

  compileNewAbstractInterface(runner, callback) {
    find_contracts(runner.config.contracts_directory, err => {
      if (err) return callback(err);

      const config = runner.config;
      if (!config.compilers.solc.version) SafeSend = "NewSafeSend.sol";
      else if (semver.lt(semver.coerce(config.compilers.solc.version), "0.5.0"))
        SafeSend = "OldSafeSend.sol";
      else SafeSend = "NewSafeSend.sol";

      compile.with_dependencies(
        runner.config.with({
          paths: [
            path.join(__dirname, "truffle/Assert.sol"),
            path.join(__dirname, "truffle/AssertAddress.sol"),
            path.join(__dirname, "truffle/AssertAddressArray.sol"),
            // path.join(__dirname, "truffle/AssertAddressPayableArray.sol"),
            path.join(__dirname, "truffle/AssertBalance.sol"),
            path.join(__dirname, "truffle/AssertBool.sol"),
            path.join(__dirname, "truffle/AssertBytes32.sol"),
            path.join(__dirname, "truffle/AssertBytes32Array.sol"),
            path.join(__dirname, "truffle/AssertGeneral.sol"),
            path.join(__dirname, "truffle/AssertInt.sol"),
            path.join(__dirname, "truffle/AssertIntArray.sol"),
            path.join(__dirname, "truffle/AssertString.sol"),
            path.join(__dirname, "truffle/AssertUint.sol"),
            path.join(__dirname, "truffle/AssertUintArray.sol"),
            path.join(__dirname, "truffle/DeployedAddresses.sol"),
            path.join(__dirname, SafeSend)
          ],
          quiet: true
        }),
        (err, contracts) => {
          if (err) return callback(err);

          // Set network values.
          Object.keys(contracts).forEach(name => {
            contracts[name].network_id = runner.config.network_id;
            contracts[name].default_network = runner.config.default_network;
          });

          runner.config.artifactor
            .saveAll(contracts, runner.config.contracts_build_directory)
            .then(() => {
              callback();
            })
            .catch(callback);
        }
      );
    });
  },

  deployTestDependencies(abstraction, dependency_paths, runner, callback) {
    const deployer = new Deployer(
      runner.config.with({
        logger: { log() {} }
      })
    );

    const Assert = runner.config.resolver.require("truffle/Assert.sol");
    const AssertAddress = runner.config.resolver.require(
      "truffle/AssertAddress.sol"
    );
    const AssertAddressArray = runner.config.resolver.require(
      "truffle/AssertAddressArray.sol"
    );
    //const AssertAddressPayableArray = runner.config.resolver.require(
    // "truffle/AssertAddressPayableArray.sol"
    //);
    const AssertBalance = runner.config.resolver.require(
      "truffle/AssertBalance.sol"
    );
    const AssertBool = runner.config.resolver.require("truffle/AssertBool.sol");
    const AssertBytes32 = runner.config.resolver.require(
      "truffle/AssertBytes32.sol"
    );
    const AssertBytes32Array = runner.config.resolver.require(
      "truffle/AssertBytes32Array.sol"
    );
    const AssertGeneral = runner.config.resolver.require(
      "truffle/AssertGeneral.sol"
    );
    const AssertInt = runner.config.resolver.require("truffle/AssertInt.sol");
    const AssertIntArray = runner.config.resolver.require(
      "truffle/AssertIntArray.sol"
    );
    const AssertString = runner.config.resolver.require(
      "truffle/AssertString.sol"
    );
    const AssertUint = runner.config.resolver.require("truffle/AssertUint.sol");
    const AssertUintArray = runner.config.resolver.require(
      "truffle/AssertUintArray.sol"
    );
    const DeployedAddresses = runner.config.resolver.require(
      "truffle/DeployedAddresses.sol"
    );
    SafeSend = runner.config.resolver.require(SafeSend);

    deployer
      .deploy(Assert)
      .then(() => deployer.deploy(AssertAddress))
      .then(() => deployer.deploy(AssertAddressArray))
      // .then(() => deployer.deploy(AssertAddressPayableArray))
      .then(() => deployer.deploy(AssertBalance))
      .then(() => deployer.deploy(AssertBool))
      .then(() => deployer.deploy(AssertBytes32))
      .then(() => deployer.deploy(AssertBytes32Array))
      .then(() => deployer.deploy(AssertGeneral))
      .then(() => deployer.deploy(AssertInt))
      .then(() => deployer.deploy(AssertIntArray))
      .then(() => deployer.deploy(AssertString))
      .then(() => deployer.deploy(AssertUint))
      .then(() => deployer.deploy(AssertUintArray))
      .then(() => deployer.deploy(DeployedAddresses))
      .then(() => {
        return dependency_paths.forEach(dependency_path => {
          const dependency = runner.config.resolver.require(dependency_path);

          if (dependency.isDeployed()) deployer.link(dependency, abstraction);
        });
      });

    let deployed;
    deployer
      .deploy(abstraction)
      .then(() => {
        return abstraction.deployed();
      })
      .then(instance => {
        deployed = instance;
        if (deployed.initialBalance) {
          return deployed.initialBalance.call();
        } else {
          return 0;
        }
      })
      .then(balance => {
        if (balance !== 0) {
          return deployer
            .deploy(SafeSend, deployed.address, {
              value: balance
            })
            .then(() => {
              return SafeSend.deployed();
            })
            .then(safesend => {
              return safesend.deliver();
            });
        }
      });

    deployer
      .start()
      .then(() => {
        callback();
      })
      .catch(callback);
  }
};

module.exports = SolidityTest;
