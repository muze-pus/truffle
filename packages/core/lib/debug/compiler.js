const WorkflowCompile = require("@truffle/workflow-compile");
const Resolver = require("@truffle/resolver");
const glob = require("glob");
const path = require("path");

class DebugCompiler {
  constructor(config) {
    this.config = config;
  }

  async compile({ withTests }) {
    let compileConfig = this.config.with({ quiet: true });

    if (withTests) {
      const testResolver = new Resolver(this.config, {
        includeTruffleSources: true
      });
      const testFiles = glob
        .sync(`${this.config.test_directory}/**/*.sol`)
        .map(filePath => path.resolve(filePath));
      compileConfig = compileConfig.with({
        resolver: testResolver,
        //note we only need to pass *additional* files
        files: testFiles
      });
    }

    const { compilations } = await WorkflowCompile.compile(compileConfig.with({ all: true }));

    return compilations;
  }
}

module.exports = {
  DebugCompiler
};
