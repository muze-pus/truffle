import assert from "assert";

import { NPM } from "../lib/sources/npm";
const npm = new NPM("");

describe("npm", function () {
  describe("#require()", function () {
    it("returns file contents from artifacts in build/contracts", function () {
      let result = npm.require("package/Test", "./test/fixtures");
      assert.deepEqual(result, {});
    });
    it("returns file contents from artifacts in build dir", function () {
      let result = npm.require("package/SomeArtifact", "./test/fixtures");
      assert.deepEqual(result.hello, "mr. anderson");
    });
    it("reads package name with /", function () {
      let result = npm.require("@org/package/Test", "./test/fixtures");
      assert.deepEqual(result, {});
    });
  });
});
