var MemoryLogger = require("../memorylogger");
var CommandRunner = require("../commandrunner");
var contract = require("truffle-contract");
var fs = require("fs");
var path = require("path");
var assert = require("assert");
var sandbox = require("../sandbox");
var Server = require("../server");
var Reporter = require("../reporter");

describe("`truffle compile` as external", function() {
  var config;
  var project = path.join(__dirname, '../../sources/external_compile');
  var logger = new MemoryLogger();

  before("set up the server", function(done) {
    Server.start(done);
  });

  after("stop server", function(done) {
    Server.stop(done);
  });

  before("set up sandbox", function() {
    this.timeout(10000);
    return sandbox.create(project).then(conf => {
      config = conf;
      config.network = "development";
      config.logger = logger;
      config.mocha = {
        reporter: new Reporter(logger)
      }
    });
  });

  it("will compile", function(done) {
    this.timeout(20000);

    CommandRunner.run("compile --compiler=external", config, function(err) {
      var output = logger.contents();
      if (err) {
        console.log(output);
        return done(err);
      }

      assert(fs.existsSync(path.join(config.contracts_build_directory, "MetaCoin.json")));
      assert(fs.existsSync(path.join(config.contracts_build_directory, "ConvertLib.json")));
      assert(fs.existsSync(path.join(config.contracts_build_directory, "Migrations.json")));

      done();
    });
  });

  it("will migrate", function(done) {
    this.timeout(50000);

    CommandRunner.run("migrate", config, function(err) {
      var output = logger.contents();
      if (err) {
        console.log(output);
        return done(err);
      }

      var MetaCoin = contract(require(path.join(config.contracts_build_directory, "MetaCoin.json")));
      var ConvertLib = contract(require(path.join(config.contracts_build_directory, "ConvertLib.json")));
      var Migrations = contract(require(path.join(config.contracts_build_directory, "Migrations.json")));

      var promises = [];

      [MetaCoin, ConvertLib, Migrations].forEach(function(abstraction) {
        abstraction.setProvider(config.provider);

        promises.push(abstraction.deployed().then(function(instance) {
          assert.notEqual(instance.address, null, instance.contract_name + " didn't have an address!")
        }));
      });

      Promise.all(promises).then(function() {
        done();
      }).catch(done);
    });
  });

  it("will run tests", function(done) {
    this.timeout(70000);
    CommandRunner.run("test", config, function(err) {
      var output = logger.contents();
      if (err) {
        console.log(output);
        return done(err);
      }

      assert(output.indexOf("3 passing") >= 0);
      done();
    });
  });


});
