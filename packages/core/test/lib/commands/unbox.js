const assert = require("assert");
const unbox = require("../../../lib/commands/unbox");
const Config = require("@truffle/config");
const sinon = require("sinon");
const tmp = require("tmp");
tmp.setGracefulCleanup();
let tempDir, config;

describe("commands/unbox.js", () => {
  const invalidBoxFormats = ["bare-box//"];
  const validBoxInput = [
    "bare",
    "truffle-box/bare-box",
    "truffle-box/bare-box#master",
    "https://github.com/truffle-box/bare-box",
    "https://github.com:truffle-box/bare-box",
    "https://github.com/truffle-box/bare-box#master",
    "git@github.com:truffle-box/bare-box",
    "git@github.com:truffle-box/bare-box#master",
    "../box/test/sources/mock-local-box"
  ];

  describe("run", () => {
    beforeEach(() => {
      tempDir = tmp.dirSync({
        unsafeCleanup: true
      });
      config = Config.default().with({
        working_directory: tempDir.name,
        quiet: true
      });
      sinon.stub(Config, "default").returns(config);
    });
    afterEach(() => {
      Config.default.restore();
    });

    describe("Error handling", () => {
      it("throws when passed an invalid box format", async () => {
        const promises = [];
        for (const path of invalidBoxFormats) {
          promises.push(
            unbox
              .run({ _: [`${path}`] })
              .then(() => assert.fail())
              .catch(_error => assert(true))
          );
        }
        return await Promise.all(promises);
      });
    });

    describe("successful unboxes", () => {
      it("runs when passed valid box input", async function () {
        let promises = [];
        validBoxInput.forEach(val => {
          promises.push(
            unbox
              .run({ _: [`${val}`], force: true })
              .then(() => assert(true))
              .catch(assert.fail)
          );
        });
        return await Promise.all(promises);
      }).timeout(10000);
    });
  });
});
