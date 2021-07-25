const assert = require("assert");
const path = require("path");

// Use transpiled output to properly test the path manipulation
// truffle resolver utilizes
const { Truffle } = require("../dist/lib/sources/truffle");
const resolver = new Truffle({});

describe("truffle resolve [ @win ]", function () {

  describe("assertion contracts", () => {
    [
      "Assert",
      "AssertAddress",
      "AssertAddressArray",
      "AssertBalance",
      "AssertBool",
      "AssertBytes32",
      "AssertBytes32Array",
      "AssertGeneral",
      "AssertInt",
      "AssertIntArray",
      "AssertString",
      "AssertUint",
      "AssertUintArray",
      "SafeSend",
    ].forEach(lib => {
      it(`resolves truffle/${lib}.sol`, async () => {
        const dependency = path.join("truffle", `${lib}.sol`);
        let result = await resolver.resolve(dependency);
        assert(
          result.filePath.includes(dependency),
          `should have resovled 'truffle${path.sep}${lib}.sol'`
        );
      })
    })
  });

  describe.skip("DeployedAddresses Contracts", () => {
    // "DeployedAddresses"
    // TODO: Not sure how to set this up
  })
});
