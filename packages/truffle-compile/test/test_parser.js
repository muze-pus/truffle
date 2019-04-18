const fs = require("fs");
const path = require("path");
const Parser = require("../parser");
const CompilerSupplier = require("../compilerSupplier");
const assert = require("assert");

describe("Parser", () => {
  let source = null;
  let erroneousSource = null;
  let solc;

  before("get code", async () => {
    source = fs.readFileSync(
      path.join(__dirname, "./sources/badSources/MyContract.sol"),
      "utf-8"
    );
    erroneousSource = fs.readFileSync(
      path.join(__dirname, "./sources/badSources/ShouldError.sol"),
      "utf-8"
    );
    const supplier = new CompilerSupplier();
    solc = await supplier.load();
  });

  it("should return correct imports with solcjs", () => {
    const imports = Parser.parseImports(source, solc);

    // Note that this test is important because certain parts of the solidity
    // output cuts off path prefixes like "./" and "../../../". If we get the
    // imports list incorrectly, we'll have collisions.
    const expected = [
      "./Dependency.sol",
      "./path/to/AnotherDep.sol",
      "../../../path/to/AnotherDep.sol",
      "ethpmpackage/Contract.sol"
    ];

    assert.deepEqual(imports, expected);
  });

  it("should return correct imports with native solc", () => {
    const config = { version: "native" };
    const nativeSupplier = new CompilerSupplier(config);
    nativeSupplier.load().then(nativeSolc => {
      const imports = Parser.parseImports(source, nativeSolc);

      // Note that this test is important because certain parts of the solidity
      // output cuts off path prefixes like "./" and "../../../". If we get the
      // imports list incorrectly, we'll have collisions.
      const expected = [
        "./Dependency.sol",
        "./path/to/AnotherDep.sol",
        "../../../path/to/AnotherDep.sol",
        "ethpmpackage/Contract.sol"
      ];

      assert.deepEqual(imports, expected);
    });
  });

  it("should return correct imports with docker solc", () => {
    const config = { docker: true, version: "0.4.25" };
    const dockerSupplier = new CompilerSupplier(config);
    dockerSupplier.load().then(dockerSolc => {
      const imports = Parser.parseImports(source, dockerSolc);

      // Note that this test is important because certain parts of the solidity
      // output cuts off path prefixes like "./" and "../../../". If we get the
      // imports list incorrectly, we'll have collisions.
      const expected = [
        "./Dependency.sol",
        "./path/to/AnotherDep.sol",
        "../../../path/to/AnotherDep.sol",
        "ethpmpackage/Contract.sol"
      ];

      assert.deepEqual(imports, expected);
    });
  });

  it("should throw an error when parsing imports if there's an actual parse error", () => {
    let error = null;
    try {
      Parser.parseImports(erroneousSource, solc);
    } catch (e) {
      error = e;
    }

    if (!error) {
      throw new Error("Expected a parse error but didn't get one!");
    }

    assert(
      error.message.includes("Expected pragma, import directive or contract")
    );
  });
});
